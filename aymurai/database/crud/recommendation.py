import re
import uuid
from dataclasses import dataclass, field
from datetime import date

from datetime_matcher import DatetimeMatcher
from sqlalchemy import func
from sqlmodel import Session, select

from aymurai.database.crud.dataset import get_or_create_default_dataset
from aymurai.database.crud.organigram.sector import is_sector_ancestor_of
from aymurai.database.schema import (
    MacroSector,
    OrganigramUnit,
    Recipient,
    Recommendation,
    Subtopic,
    Topic,
)
from aymurai.text.matching import normalize_text
from aymurai.transforms.datetime_formatter.core import extract_valid_datetime
from aymurai.transforms.datetime_formatter.patterns import DATES

_dtm = DatetimeMatcher()

# `DATES`'s last pattern (`"%-d de %B"`) has no year token at all -- tried
# against text that *does* have a year, it still matches (ignoring the year
# in the text) and silently defaults to year 1900 instead of failing.
# Confirmed: dtm.extract_datetime(r"(?i)%-d de %B", "5 de mayo de 2024") ->
# 1900-05-05. A recommendation date is always meant to carry a real year (per
# our own prompt's format), so we only ever try patterns that require one.
_YEAR_REQUIRED_DATES = [p for p in DATES if "%Y" in p or "%y" in p]

# Locale-independent fallback for exactly the one prose shape our own prompt
# asks the LLM for ("DD de MES de YYYY"): `DATES`'s %B patterns need the
# es_AR locale, which not every machine running this code has (see
# aymurai.transforms.datetime_formatter.patterns). Without it, every %B
# pattern simply fails to match -- this fallback keeps this one shape
# parseable everywhere regardless of the OS locale.
_SPANISH_MONTHS = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}
_PROSE_DATE_PATTERN = re.compile(
    r"(\d{1,2})\s*(?:°|º|ro\.?)?\s+de\s+([a-záéíóúñ]+)\s+de[l]?\s+(\d{4})",
    re.IGNORECASE,
)


def _parse_spanish_prose_date(text: str) -> date | None:
    match = _PROSE_DATE_PATTERN.search(text)
    if not match:
        return None
    day, month_name, year = match.groups()
    month = _SPANISH_MONTHS.get(month_name.lower())
    if month is None:
        return None
    try:
        return date(int(year), month, int(day))
    except ValueError:
        return None


def parse_recommendation_date(text: str | None) -> date | None:
    """
    Parses verbatim date prose (e.g. "01 de enero de 2024") into a real date.

    Tries the house `DATES` patterns first (shared with
    `aymurai.transforms.datetime_formatter`, day-validated by
    `extract_valid_datetime`) -- these need the es_AR locale to match month
    names, which isn't installed on every machine. When none match (whether
    because the locale is missing or the shape is genuinely different), falls
    back to a locale-independent parser for our own prompt's one prose shape.

    Args:
        text (str | None): Verbatim date prose from the model/human.

    Returns:
        date | None: The parsed date, or None if nothing recognized it.
    """
    if not text:
        return None

    for pattern in _YEAR_REQUIRED_DATES:
        parsed = extract_valid_datetime(_dtm, pattern, text)
        if parsed:
            return parsed.date()

    return _parse_spanish_prose_date(text)


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


def recommendation_list(
    session: Session,
    *,
    topic_id: uuid.UUID | None = None,
    sector_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
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
        q (str | None): Case-insensitive substring search over
            `publishable_content`.
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
    if q:
        # Escaped, not raw: `q` is the caller's literal text, so `%`/`_` must
        # match themselves rather than being reinterpreted as wildcards.
        needle = _like_escape(q.lower())
        statement = statement.where(
            func.lower(Recommendation.publishable_content).like(
                f"%{needle}%", escape="\\"
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

    total = len(session.exec(statement).all())

    statement = (
        statement.order_by(Recommendation.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = list(session.exec(statement).all())
    return items, total
