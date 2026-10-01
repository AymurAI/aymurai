"""The one clock persisted timestamps are read from."""

from datetime import UTC, datetime


def utc_now() -> datetime:
    """
    Returns the current instant as a naive UTC `datetime`, microseconds kept.

    Naive because every timestamp column in the base is naive UTC -- that is
    what SQLite's `CURRENT_TIMESTAMP` writes, and what the API serializes and
    the export converts with `settings.EXPORT_TIMEZONE`. Read from Python
    rather than the database because `CURRENT_TIMESTAMP`/`func.now()` only
    have whole-second resolution on SQLite: two writes within the same second
    would share a version, and a version is what `If-Match` compares.

    Returns:
        datetime: Current UTC time, `tzinfo=None`.
    """
    return datetime.now(UTC).replace(tzinfo=None)
