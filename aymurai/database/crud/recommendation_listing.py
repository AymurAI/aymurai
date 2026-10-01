"""Dataset-scoped recommendation search, filtering, and pagination."""

import uuid
from datetime import date
from typing import Literal

from sqlalchemy import func, or_
from sqlalchemy.orm import InstrumentedAttribute
from sqlmodel import Session, select

from aymurai.database.crud.dataset import get_or_create_default_dataset
from aymurai.database.schema import (
    MacroSector,
    OrganigramUnit,
    Recipient,
    Recommendation,
    RecommendationSituation,
    RecommendationStatus,
    Subtopic,
    Topic,
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

_SEARCH_COLUMNS: tuple[InstrumentedAttribute, ...] = (
    Recommendation.recommendation_number,
    Recommendation.file_number,
    Recommendation.recommendation_detail,
    Recommendation.publishable_content,
    Recommendation.link,
)


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


def recommendation_list(
    session: Session,
    *,
    topic_id: uuid.UUID | None = None,
    subtopic_id: uuid.UUID | None = None,
    sector_id: uuid.UUID | None = None,
    macro_sector_id: uuid.UUID | None = None,
    recommendation_situation: RecommendationSituation | None = None,
    status: RecommendationStatus | None = None,
    approved_for_publication: bool | None = None,
    publication_unanswered: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    edited_from: date | None = None,
    edited_to: date | None = None,
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
        macro_sector_id (uuid.UUID | None): Match any recipient in this ámbito.
        recommendation_situation (RecommendationSituation | None): Situation filter.
        status (RecommendationStatus | None): Resolution status filter.
        approved_for_publication (bool | None): Match yes or no, excluding unanswered.
        publication_unanswered (bool): Match unanswered only; false adds no filter.
        date_from (date | None): Minimum `recommendation_date` (inclusive).
        date_to (date | None): Maximum `recommendation_date` (inclusive).
        q (str | None): Case-insensitive substring search, matched against
            recommendation text and all recipients and their resolved names.
        unparsed_dates (bool): Restrict to rows with prose
            (`recommendation_date_text`) but no successfully parsed
            `recommendation_date` -- exactly the rows that need human
            correction.
        order_by (RecommendationOrderColumn): Column to sort by, whitelisted
            (issue #58) to columns that don't require a join.
        order_dir (Literal["asc", "desc"]): Sort direction. Nulls always
            sort last, in both directions.
        page (int): 1-indexed page number.
        page_size (int): Rows per page.

    Returns:
        tuple[list[Recommendation], int]: (page of results, total matching
            rows across all pages).
    """
    if publication_unanswered and approved_for_publication is not None:
        raise ValueError(
            "publication_unanswered cannot be combined with approved_for_publication"
        )

    dataset = get_or_create_default_dataset(session)
    statement = select(Recommendation).where(Recommendation.dataset_id == dataset.id)

    if topic_id is not None:
        statement = statement.where(Recommendation.topic_id == topic_id)
    if subtopic_id is not None:
        statement = statement.where(Recommendation.subtopic_id == subtopic_id)
    if date_from is not None:
        statement = statement.where(Recommendation.recommendation_date >= date_from)
    if date_to is not None:
        statement = statement.where(Recommendation.recommendation_date <= date_to)
    last_edited = func.date(
        func.coalesce(Recommendation.updated_at, Recommendation.created_at)
    )
    if edited_from is not None:
        statement = statement.where(last_edited >= edited_from)
    if edited_to is not None:
        statement = statement.where(last_edited <= edited_to)
    if q:
        # Escaped, not raw: `q` is the caller's literal text, so `%`/`_` must
        # match themselves rather than being reinterpreted as wildcards.
        needle = _like_escape(q.lower())
        pattern = f"%{needle}%"
        matching_units = select(OrganigramUnit.id).where(
            func.lower(OrganigramUnit.name).like(pattern, escape="\\")
        )
        matching_macros = select(MacroSector.id).where(
            func.lower(MacroSector.name).like(pattern, escape="\\")
        )
        matching_topics = select(Topic.id).where(
            func.lower(Topic.name).like(pattern, escape="\\")
        )
        matching_subtopics = select(Subtopic.id).where(
            func.lower(Subtopic.name).like(pattern, escape="\\")
        )
        matching_recipients = select(Recipient.recommendation_id).where(
            or_(
                func.lower(Recipient.raw_name).like(pattern, escape="\\"),
                func.lower(Recipient.raw_position).like(pattern, escape="\\"),
                Recipient.unit_id.in_(matching_units),
                Recipient.sector_id.in_(matching_units),
                Recipient.macro_sector_id.in_(matching_macros),
            )
        )
        # IN subqueries preserve one recommendation per result, even when
        # several secondary recipients match the same search.
        statement = statement.where(
            or_(
                Recommendation.id.in_(matching_recipients),
                Recommendation.topic_id.in_(matching_topics),
                Recommendation.subtopic_id.in_(matching_subtopics),
                *(
                    func.lower(column).like(pattern, escape="\\")
                    for column in _SEARCH_COLUMNS
                ),
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
    if macro_sector_id is not None:
        statement = statement.where(
            Recommendation.id.in_(
                select(Recipient.recommendation_id).where(
                    Recipient.macro_sector_id == macro_sector_id
                )
            )
        )
    if recommendation_situation is not None:
        statement = statement.where(
            Recommendation.recommendation_situation == recommendation_situation
        )
    if status is not None:
        statement = statement.where(Recommendation.status == status)
    if approved_for_publication is not None:
        statement = statement.where(
            Recommendation.approved_for_publication == approved_for_publication
        )
    if publication_unanswered:
        statement = statement.where(Recommendation.approved_for_publication.is_(None))
    if unparsed_dates:
        statement = statement.where(
            Recommendation.recommendation_date_text.is_not(None),
            Recommendation.recommendation_date.is_(None),
        )

    total = session.exec(select(func.count()).select_from(statement.subquery())).one()

    column = _ORDER_COLUMNS[order_by]
    order_clause = column.asc() if order_dir == "asc" else column.desc()
    statement = (
        statement.order_by(order_clause.nullslast())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = list(session.exec(statement).all())
    return items, total
