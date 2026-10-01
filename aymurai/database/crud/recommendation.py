import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from sqlalchemy import func, or_
from sqlalchemy.orm import InstrumentedAttribute
from sqlmodel import Session, select

from aymurai.database.crud.dataset import get_or_create_default_dataset
from aymurai.database.crud.organigram.sector import is_sector_ancestor_of
from aymurai.database.schema import (
    MacroSector,
    OrganigramUnit,
    Recipient,
    Recommendation,
    RecommendationUpdate,
    Subtopic,
    Topic,
)
from aymurai.database.session import NORMALIZE_TEXT_SQL_FUNCTION
from aymurai.text.matching import normalize_text
from aymurai.transforms.datetime_formatter.recommendation_prose import (
    parse_recommendation_date,
)

# issue #58: columnas propias de la recomendación ordenables desde la grilla.
# Los órdenes que exigen join (tema, sector) quedan fuera. `Literal` es lo que
# hace que FastAPI devuelva 422 automáticamente ante cualquier valor fuera de
# esta whitelist -- no hace falta validar a mano.
RecommendationOrderColumn = Literal[
    "created_at",
    "recommendation_date",
    "recommendation_number",
    "status",
    "recommendation_situation",
    "file_number",
]

_ORDER_COLUMNS: dict[str, InstrumentedAttribute] = {
    "created_at": Recommendation.created_at,
    "recommendation_date": Recommendation.recommendation_date,
    "recommendation_number": Recommendation.recommendation_number,
    "status": Recommendation.status,
    "recommendation_situation": Recommendation.recommendation_situation,
    "file_number": Recommendation.file_number,
}

# The columns the free-text search (`q`) spans. Kept to columns owned by
# `Recommendation` itself so one search stays one table scan -- `topic`/
# `sector` would each need a join, which issue #58 rules out for this tajada.
# The frontend's mock (`mockDataExtraction.ts`) and the search box's
# placeholder copy both mirror exactly this list.
_SEARCH_COLUMNS: tuple[InstrumentedAttribute, ...] = (
    Recommendation.recommendation_number,
    Recommendation.file_number,
    Recommendation.recommendation_detail,
    Recommendation.publishable_content,
)


class InconsistentSectorError(Exception):
    """`sector_id` isn't `unit_id`'s ancestor-or-self in the organigram."""


class OrganigramReferenceNotFoundError(Exception):
    """`unit_id`/`sector_id` doesn't match any existing `organigram_unit` row --
    must never be silently swallowed into a null reference."""


@dataclass
class RecipientValidationData:
    id: uuid.UUID | None
    name: str | None
    position: str | None
    is_primary: bool
    macro_sector: str | None  # label, resolved against macro_sector.name
    unit_id: uuid.UUID | None  # human-confirmed, used directly
    sector_id: (
        uuid.UUID | None
    )  # human-confirmed, used directly -- never derived from unit_id
    # Index into extraction.prediction.recipients this came from; None for a
    # recipient the person added by hand. Placed last (with a default) because
    # every field above it is a required positional/keyword arg -- a dataclass
    # can't put a defaulted field ahead of one without a default.
    source_index: int | None = None


@dataclass
class RecommendationValidationData:
    recommendation_number: str | None
    recommendation_date_text: str | None
    topic: str | None  # label, resolved against topic.name
    subtopic: str | None  # label, resolved against subtopic.name (scoped to topic)
    personal_data: bool | None
    publishable_content: str
    recipients: list[RecipientValidationData] = field(default_factory=list)
    # Explicit human override from the date-picker field, wins over
    # `parse_recommendation_date(recommendation_date_text)` when given --
    # `None` keeps today's auto-parse-on-every-save behavior unchanged.
    recommendation_date: date | None = None


def _resolve_topic_subtopic(
    topic_label: str | None, subtopic_label: str | None, session: Session
) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    topic = None
    if topic_label:
        topic = session.exec(select(Topic).where(Topic.name == topic_label)).first()

    subtopic = None
    if subtopic_label and topic:
        subtopic = session.exec(
            select(Subtopic)
            .where(Subtopic.topic_id == topic.id)
            .where(Subtopic.name == subtopic_label)
        ).first()

    return (topic.id if topic else None, subtopic.id if subtopic else None)


def _like_escape(value: str) -> str:
    """
    Escapes LIKE metacharacters so a user's literal text matches itself.

    Args:
        value (str): Raw user text.

    Returns:
        str: The text with `\\`, `%` and `_` escaped for use with
            `.like(..., escape="\\")`. The backslash is escaped first, or it
            would double-escape the sentinels added after it.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _reconcile_recipients(
    recommendation_id: uuid.UUID,
    recipients: list[RecipientValidationData],
    session: Session,
) -> None:
    """
    Upserts recipients by id: incoming rows with an id update in place, rows
    without one are inserted, and existing rows not present in the incoming
    list are deleted. Never deletes-and-recreates the whole set -- that's
    exactly what broke index-based matching in the historical frontend.
    """
    existing_by_id = {
        r.id: r
        for r in session.exec(
            select(Recipient).where(Recipient.recommendation_id == recommendation_id)
        ).all()
    }
    seen_ids: set[uuid.UUID] = set()

    for order, item in enumerate(recipients):
        macro_sector = None
        if item.macro_sector:
            macro_sector = session.exec(
                select(MacroSector).where(MacroSector.name == item.macro_sector)
            ).first()

        # A recipient's ámbito can be *explicitly* corrected away from GCBA
        # after a unit was already picked while it looked GCBA -- the
        # frontend's unit picker hides rather than clears a prior pick when
        # the ámbito toggles non-GCBA (recipient-fields.tsx, by documented
        # design: "hidden rather than cleared ... so a prior pick survives an
        # accidental sector toggle"), and `toPayload` still sends the stale
        # unit_id/sector_id unconditionally. Treat them as not-provided here
        # rather than rejecting the save: the picker that would let the human
        # clear them is exactly the one now hidden, so raising would trap the
        # correction with no way through the UI to fix it. This only fires
        # for an explicitly non-GCBA macro_sector -- `macro_sector is None`
        # (nothing resolved: not provided, or an implicitly-suggested GCBA
        # ámbito never explicitly confirmed) must keep trusting unit_id/
        # sector_id exactly as before.
        unit_id = item.unit_id
        sector_id = item.sector_id
        if macro_sector is not None and macro_sector.code != "GCBA":
            unit_id = None
            sector_id = None

        unit = session.get(OrganigramUnit, unit_id) if unit_id else None
        sector = session.get(OrganigramUnit, sector_id) if sector_id else None

        if unit_id is not None and unit is None:
            raise OrganigramReferenceNotFoundError(
                f"unit_id {unit_id} does not exist in the organigram"
            )
        if sector_id is not None and sector is None:
            raise OrganigramReferenceNotFoundError(
                f"sector_id {sector_id} does not exist in the organigram"
            )

        # ADR-0001: `is_sector` is the single source of truth for what a
        # sector is. Checked before the pair-consistency block below, which
        # only runs when a `unit_id` is present -- without this, a plain unit
        # passed as `sector_id` with no `unit_id` was stored unchallenged and
        # later exported as SECTOR_FINAL.
        if sector is not None and not sector.is_sector:
            raise InconsistentSectorError(
                f"sector_id {sector_id} is not a sector "
                "(is_sector=False) in the organigram"
            )

        # Membership, not identity: `resolve_sector` skips deactivated
        # sectors, so the pair the suggestion path proposes may name a sector
        # that is not `unit`'s nearest one -- and a sector deactivated after a
        # human confirmed it must not retroactively invalidate their row.
        if unit is not None and sector is not None:
            if not is_sector_ancestor_of(sector, unit, session):
                raise InconsistentSectorError(
                    f"sector_id {sector_id} is not unit_id {unit_id}'s "
                    "sector in the organigram"
                )

        values = {
            "order": order,
            "source_index": item.source_index,
            "raw_name": item.name,
            "raw_position": item.position,
            "normalized_name": normalize_text(item.name) or None,
            "normalized_position": normalize_text(item.position) or None,
            "is_primary": item.is_primary,
            "macro_sector_id": macro_sector.id if macro_sector else None,
            "unit_id": unit.id if unit else None,
            "sector_id": sector.id if sector else None,
        }

        if item.id is not None and item.id in existing_by_id:
            recipient = existing_by_id[item.id]
            for field_name, value in values.items():
                setattr(recipient, field_name, value)
            session.add(recipient)
            seen_ids.add(item.id)
        else:
            recipient = Recipient(recommendation_id=recommendation_id, **values)
            session.add(recipient)
            seen_ids.add(recipient.id)

    for existing_id, recipient in existing_by_id.items():
        if existing_id not in seen_ids:
            session.delete(recipient)

    # The caller owns the transaction boundary (see `recommendation_upsert`).
    session.flush()


def recommendation_upsert(
    document_id: uuid.UUID, data: RecommendationValidationData, session: Session
) -> Recommendation:
    """
    Creates or updates the recommendation for a document, plus its recipients
    (see `_reconcile_recipients`). A recommendation only ever exists after
    this is called -- it's the human-validated row, distinct from the raw
    `extraction` cache.

    Args:
        document_id (uuid.UUID): The extraction this validation is for.
        data (RecommendationValidationData): Validated fields, labels
            unresolved.
        session (Session): Database session.

    Returns:
        Recommendation: The persisted recommendation.
    """
    dataset = get_or_create_default_dataset(session)
    topic_id, subtopic_id = _resolve_topic_subtopic(data.topic, data.subtopic, session)
    recommendation_date = (
        data.recommendation_date
        if data.recommendation_date is not None
        else parse_recommendation_date(data.recommendation_date_text)
    )

    recommendation = session.exec(
        select(Recommendation)
        .where(Recommendation.dataset_id == dataset.id)
        .where(Recommendation.document_id == document_id)
    ).first()

    values = {
        "recommendation_number": data.recommendation_number,
        "recommendation_date_text": data.recommendation_date_text,
        "recommendation_date": recommendation_date,
        "topic_id": topic_id,
        "subtopic_id": subtopic_id,
        "personal_data": data.personal_data,
        "publishable_content": data.publishable_content,
    }

    if recommendation is None:
        recommendation = Recommendation(
            dataset_id=dataset.id, document_id=document_id, **values
        )
        session.add(recommendation)
    else:
        for field_name, value in values.items():
            setattr(recommendation, field_name, value)
        session.add(recommendation)

    # Flush, don't commit: `_reconcile_recipients` still has to validate every
    # unit_id/sector_id, and ADR-0009 requires the whole transaction to be cut
    # if any single recipient is rejected. Flushing makes the recommendation
    # row visible to the recipients' foreign key without making it durable.
    session.flush()

    _reconcile_recipients(recommendation.id, data.recipients, session)

    session.commit()
    session.refresh(recommendation)
    return recommendation


def recommendation_get(
    recommendation_id: uuid.UUID, session: Session
) -> Recommendation | None:
    """
    Reads a recommendation record by ID.

    Args:
        recommendation_id (uuid.UUID): Recommendation UUID.
        session (Session): Database session.

    Returns:
        Recommendation | None: Recommendation record if found.
    """
    return session.get(Recommendation, recommendation_id)


def recommendation_get_by_document(
    document_id: uuid.UUID, session: Session
) -> Recommendation | None:
    """
    Reads a recommendation by the document it was validated from, scoped to
    the shared dataset.

    Args:
        document_id (uuid.UUID): The extraction/document UUID.
        session (Session): Database session.

    Returns:
        Recommendation | None: Recommendation record if found.
    """
    dataset = get_or_create_default_dataset(session)
    return session.exec(
        select(Recommendation)
        .where(Recommendation.dataset_id == dataset.id)
        .where(Recommendation.document_id == document_id)
    ).first()


def recommendation_update_seguimiento(
    recommendation_id: uuid.UUID, update: RecommendationUpdate, session: Session
) -> Recommendation:
    """
    Actualiza sólo los seis campos de seguimiento de una recomendación existente.

    Ausente en `update` = no toca ese campo (por `exclude_unset=True`); presente
    en `None` = lo limpia. Nunca toca los campos que vienen del documento --
    ésos son responsabilidad exclusiva de `recommendation_upsert`.

    Raises:
        ValueError: Si la recomendación no existe.
    """
    recommendation = session.get(Recommendation, recommendation_id)
    if not recommendation:
        raise ValueError(f"Recommendation not found: {recommendation_id}")

    for field_name, value in update.model_dump(exclude_unset=True).items():
        setattr(recommendation, field_name, value)

    session.add(recommendation)
    session.commit()
    session.refresh(recommendation)
    return recommendation


def recommendation_list(
    session: Session,
    *,
    topic_id: uuid.UUID | None = None,
    sector_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    unparsed_dates: bool = False,
    order_by: RecommendationOrderColumn = "created_at",
    order_dir: Literal["asc", "desc"] = "desc",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Recommendation], int]:
    """
    Lists recommendations in the shared dataset, filtered and paginated.

    Args:
        session (Session): Database session.
        topic_id (uuid.UUID | None): Restrict to this topic.
        sector_id (uuid.UUID | None): Restrict to recommendations with at
            least one recipient resolved to this sector.
        date_from (date | None): Minimum `recommendation_date` (inclusive).
        date_to (date | None): Maximum `recommendation_date` (inclusive).
        q (str | None): Case-insensitive substring search, matched against
            any of `_SEARCH_COLUMNS`.
        unparsed_dates (bool): Restrict to rows with prose
            (`recommendation_date_text`) but no successfully parsed
            `recommendation_date` -- exactly the rows that need human
            correction.
        order_by (RecommendationOrderColumn): Column to sort by, whitelisted
            (issue #58) to columns that don't require a join.
        order_dir (Literal["asc", "desc"]): Sort direction. Nulls always
            sort last, in both directions; ties are broken by `id`
            ascending so pagination is deterministic.
        page (int): 1-indexed page number.
        page_size (int): Rows per page.

    Returns:
        tuple[list[Recommendation], int]: (page of results, total matching
            rows across all pages).
    """
    dataset = get_or_create_default_dataset(session)
    statement = select(Recommendation).where(Recommendation.dataset_id == dataset.id)

    if topic_id is not None:
        statement = statement.where(Recommendation.topic_id == topic_id)
    if date_from is not None:
        statement = statement.where(Recommendation.recommendation_date >= date_from)
    if date_to is not None:
        statement = statement.where(Recommendation.recommendation_date <= date_to)
    # Folded with the same `normalize_text` the SQL side applies, so case and
    # accents never decide a match ("area" finds "Área", "ÁREA" finds "área").
    needle = normalize_text(q) if q else ""
    if needle:
        # Escaped, not raw: `q` is the caller's literal text, so `%`/`_` must
        # match themselves rather than being reinterpreted as wildcards.
        pattern = f"%{_like_escape(needle)}%"
        # The four text columns that live directly on `Recommendation`: one
        # search box, no joins. `tema`/`sector` are deliberately out (issue
        # #58 keeps join-bound columns out of ordering, and filtering has the
        # same cost). The SQL `normalize_text` (registered per connection in
        # `database/session.py`) maps NULL to NULL and `NULL LIKE ...` is
        # NULL, so a nullable column simply never matches -- no null guard.
        normalize = getattr(func, NORMALIZE_TEXT_SQL_FUNCTION)
        statement = statement.where(
            or_(
                *(
                    normalize(column).like(pattern, escape="\\")
                    for column in _SEARCH_COLUMNS
                )
            )
        )
    if sector_id is not None:
        statement = statement.where(
            Recommendation.id.in_(
                select(Recipient.recommendation_id).where(
                    Recipient.sector_id == sector_id
                )
            )
        )
    if unparsed_dates:
        statement = statement.where(
            Recommendation.recommendation_date_text.is_not(None),
            Recommendation.recommendation_date.is_(None),
        )

    total = session.exec(select(func.count()).select_from(statement.subquery())).one()

    column = _ORDER_COLUMNS[order_by]
    order_clause = column.asc() if order_dir == "asc" else column.desc()
    statement = (
        # `id` breaks ties: without a total order, SQLite may return tied rows
        # in a different order on each query, so consecutive pages could
        # repeat some rows and skip others.
        statement.order_by(order_clause.nullslast(), Recommendation.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = list(session.exec(statement).all())
    return items, total
