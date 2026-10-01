"""Optimistic-concurrency correction of an already-validated recommendation."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import update
from sqlmodel import Session, col

from aymurai.database.crud.recommendation import (
    RecommendationValidationData,
    recommendation_upsert,
)
from aymurai.database.schema import Recommendation


class RecommendationNotFoundError(Exception):
    """No recommendation has the requested id."""


class StaleRecommendationError(Exception):
    """The recommendation changed since the version the caller last read."""


def recommendation_version(recommendation: Recommendation) -> datetime:
    """
    The value that identifies a recommendation's current version.

    `updated_at` stays NULL until the row's first edit, so a never-corrected
    recommendation is identified by `created_at`. The client applies the same
    fallback when it picks the `If-Match` to send.

    Args:
        recommendation (Recommendation): The stored row.

    Returns:
        datetime: Naive UTC version timestamp.
    """
    return recommendation.updated_at or recommendation.created_at


def _as_naive_utc(value: datetime) -> datetime:
    """
    Normalizes a version timestamp to the naive UTC the base stores.

    An aware value (`...Z`, `...+00:00`, `...-03:00`) never compares equal to
    a naive one, so without this an etag spelled with a timezone would be a
    412 forever, however many times the client reloaded.

    Args:
        value (datetime): Naive (assumed UTC) or aware timestamp.

    Returns:
        datetime: The same instant, naive UTC.
    """
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def recommendation_lock_current(
    recommendation_id: uuid.UUID, expected_version: datetime, session: Session
) -> Recommendation:
    """
    Opens a write transaction on the row and checks it is still at
    `expected_version`.

    The no-op UPDATE comes first, before reading what to compare: on SQLite
    that is what opens the transaction (pysqlite only emits `BEGIN` ahead of
    DML) and takes the database's write lock, held until the caller commits
    or rolls back. A second correction of the same row therefore waits
    (`busy_timeout`) instead of reading the same old version in parallel,
    and once it gets the lock it reads the first one's committed version and
    fails the check. Setting `updated_at` to itself changes nothing and, being
    explicitly in `values`, keeps the column's `onupdate` from firing.

    The comparison happens in Python between `datetime`s, never in SQL:
    legacy rows store `YYYY-MM-DD HH:MM:SS` with no fraction, while a bound
    parameter renders `.000000`, so a string comparison would call the same
    instant different.

    Args:
        recommendation_id (uuid.UUID): Row to lock.
        expected_version (datetime): The version the caller last read, naive
            (UTC) or aware.
        session (Session): Database session; left inside the open transaction
            on success, rolled back on failure.

    Returns:
        Recommendation: The row, freshly read under the lock.

    Raises:
        RecommendationNotFoundError: No row has that id.
        StaleRecommendationError: The row is at a different version.
    """
    locked_id = session.execute(
        update(Recommendation)
        .where(col(Recommendation.id) == recommendation_id)
        .values(updated_at=Recommendation.updated_at)
        .returning(col(Recommendation.id))
        .execution_options(synchronize_session=False)
    ).scalar_one_or_none()
    if locked_id is None:
        session.rollback()
        raise RecommendationNotFoundError(
            f"Recommendation not found: {recommendation_id}"
        )

    recommendation = session.get(
        Recommendation, recommendation_id, populate_existing=True
    )
    if recommendation is None or recommendation_version(
        recommendation
    ) != _as_naive_utc(expected_version):
        session.rollback()
        raise StaleRecommendationError(
            "Recommendation was modified since it was last read"
        )
    return recommendation


def recommendation_correct(
    recommendation_id: uuid.UUID,
    expected_version: datetime,
    data: RecommendationValidationData,
    session: Session,
) -> Recommendation:
    """
    Replaces a recommendation's document-derived fields if, and only if, it
    is still at `expected_version` -- check and write in one transaction.

    Upserts by `document_id`, not by id: one document has at most one
    recommendation, so this reuses `/validate`'s single write path rather
    than growing a second, divergent one. `recommendation_upsert` commits,
    which is what releases the lock taken by `recommendation_lock_current`.

    Args:
        recommendation_id (uuid.UUID): Row to correct.
        expected_version (datetime): The `If-Match` version, naive (UTC) or
            aware.
        data (RecommendationValidationData): Full replacement body.
        session (Session): Database session.

    Returns:
        Recommendation: The corrected row, at a new version.

    Raises:
        RecommendationNotFoundError: No row has that id.
        StaleRecommendationError: The row moved on since the caller read it.
        InconsistentSectorError: A recipient's sector/unit pair is invalid.
        OrganigramReferenceNotFoundError: A recipient names a missing unit.
    """
    recommendation = recommendation_lock_current(
        recommendation_id, expected_version, session
    )
    try:
        return recommendation_upsert(recommendation.document_id, data, session)
    except Exception:
        session.rollback()
        raise
