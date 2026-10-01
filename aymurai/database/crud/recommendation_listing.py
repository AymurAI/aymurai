"""Dataset-scoped recommendation search, filtering, and pagination."""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, col, select

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
from aymurai.database.session import NORMALIZE_TEXT_SQL_FUNCTION
from aymurai.settings import settings
from aymurai.text.matching import normalize_text

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
    "last_edited",
]

# What the grilla's "Última edición" column shows: `updated_at` once anybody
# touched the row, `created_at` otherwise (`updated_at` stays NULL until the
# first update after creation). Stored values mix the legacy
# `CURRENT_TIMESTAMP` spelling (no fraction) with SQLAlchemy's `.ffffff` one,
# and the two don't order correctly as raw text, so it is always read through
# an SQLite date function -- a different one for filtering and for sorting.
_LAST_EDITED_RAW = func.coalesce(Recommendation.updated_at, Recommendation.created_at)

# For the "editado desde/hasta" filter: `datetime()` drops the fraction, which
# is harmless against the whole-second day bounds it is compared with.
_LAST_EDITED = func.datetime(_LAST_EDITED_RAW)

# For the `last_edited` sort: `julianday()` reads both spellings too but keeps
# the fraction, so two edits within the same second don't tie (and fall to
# the `id` tie-breaker, which knows nothing about time).
_LAST_EDITED_ORDER = func.julianday(_LAST_EDITED_RAW)

_ORDER_COLUMNS: dict[str, InstrumentedAttribute | ColumnElement] = {
    "created_at": Recommendation.created_at,
    "recommendation_date": Recommendation.recommendation_date,
    "recommendation_number": Recommendation.recommendation_number,
    "status": Recommendation.status,
    "recommendation_situation": Recommendation.recommendation_situation,
    "file_number": Recommendation.file_number,
    "last_edited": _LAST_EDITED_ORDER,
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


def _local_day_start_utc(day: date) -> str:
    """
    The UTC instant at which `day` starts in `settings.EXPORT_TIMEZONE`.

    The grilla shows "última edición" in local time (and the export dates it
    the same way, `_to_local_date`), while timestamps are stored naive UTC --
    so a day the person picks must be turned into the UTC range it covers.
    Filtering on the UTC date instead would file an edit made after 21:00 in
    Buenos Aires (UTC-3) under the following day.

    Args:
        day (date): Calendar day in the local timezone.

    Returns:
        str: Naive UTC `YYYY-MM-DD HH:MM:SS`, the format SQLite's
            `datetime()` reads and emits.
    """
    local_midnight = datetime.combine(
        day, time.min, tzinfo=ZoneInfo(settings.EXPORT_TIMEZONE)
    )
    return local_midnight.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


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
        edited_from (date | None): Minimum local day (in
            `settings.EXPORT_TIMEZONE`) of the last edit, inclusive.
        edited_to (date | None): Maximum local day of the last edit, inclusive.
        q (str | None): Case- and accent-insensitive substring search,
            matched against recommendation text and all recipients and their resolved names.
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
    # `datetime()` on both sides, not raw comparison (see `_LAST_EDITED`).
    if edited_from is not None:
        statement = statement.where(
            _LAST_EDITED >= func.datetime(_local_day_start_utc(edited_from))
        )
    if edited_to is not None:
        statement = statement.where(
            _LAST_EDITED
            < func.datetime(_local_day_start_utc(edited_to + timedelta(days=1)))
        )
    # Folded with the same `normalize_text` the SQL side applies, so case and
    # accents never decide a match ("area" finds "Área", "ÁREA" finds "área").
    needle = normalize_text(q) if q else ""
    if needle:
        # Escaped, not raw: `q` is the caller's literal text, so `%`/`_` must
        # match themselves rather than being reinterpreted as wildcards.
        pattern = f"%{_like_escape(needle)}%"
        # The SQL `normalize_text` (registered per connection in
        # `database/session.py`) maps NULL to NULL and `NULL LIKE ...` is
        # NULL, so a nullable column simply never matches -- no null guard.
        normalize = getattr(func, NORMALIZE_TEXT_SQL_FUNCTION)
        matching_units = select(OrganigramUnit.id).where(
            normalize(OrganigramUnit.name).like(pattern, escape="\\")
        )
        matching_macros = select(MacroSector.id).where(
            normalize(MacroSector.name).like(pattern, escape="\\")
        )
        matching_topics = select(Topic.id).where(
            normalize(Topic.name).like(pattern, escape="\\")
        )
        matching_subtopics = select(Subtopic.id).where(
            normalize(Subtopic.name).like(pattern, escape="\\")
        )
        matching_recipients = select(Recipient.recommendation_id).where(
            or_(
                normalize(Recipient.raw_name).like(pattern, escape="\\"),
                normalize(Recipient.raw_position).like(pattern, escape="\\"),
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
                    normalize(column).like(pattern, escape="\\")
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
        # `id` breaks ties: without a total order, SQLite may return tied rows
        # in a different order on each query, so consecutive pages could
        # repeat some rows and skip others.
        statement.order_by(order_clause.nullslast(), col(Recommendation.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = list(session.exec(statement).all())
    return items, total
