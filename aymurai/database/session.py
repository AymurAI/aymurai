from collections.abc import Generator

from sqlalchemy import event
from sqlmodel import Session, create_engine

from aymurai.settings import settings
from aymurai.text.matching import normalize_text

# Name of the SQL function every SQLite connection carries for case- and
# accent-insensitive matching (see `_sql_normalize_text`).
NORMALIZE_TEXT_SQL_FUNCTION = "normalize_text"


def _sql_normalize_text(value: str | None) -> str | None:
    """
    `normalize_text` as a SQL scalar function.

    SQLite's built-in `lower()` only folds ASCII, so `lower('Área')` keeps the
    `Á` and a search for "área" or "area" misses it. Registering the Python
    normalization lets a query fold case and accents on the column side too.

    Args:
        value (str | None): The SQL argument.

    Returns:
        str | None: The normalized text, or None for SQL NULL -- so a NULL
            column keeps never matching a LIKE, instead of becoming "" (which
            `normalize_text` returns for None).
    """
    if value is None:
        return None
    return normalize_text(value)


def _configure_sqlite_connection(dbapi_connection, connection_record) -> None:
    del connection_record
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    # WAL lets readers never block the writer (or vice versa) -- without
    # this, any read concurrent with a write could return "database is
    # locked" even for a SELECT.
    cursor.execute("PRAGMA journal_mode=WAL")
    # With WAL, "database is locked" can only happen between two concurrent
    # writers. This timeout makes the second one wait instead of failing
    # immediately.
    cursor.execute(f"PRAGMA busy_timeout={settings.SQLITE_BUSY_TIMEOUT_MS}")
    cursor.close()
    # Deterministic: same input, same output -- lets SQLite use it anywhere a
    # deterministic function is required (indexes on expressions, etc.).
    dbapi_connection.create_function(
        NORMALIZE_TEXT_SQL_FUNCTION, 1, _sql_normalize_text, deterministic=True
    )


def get_engine(echo: bool = False):
    engine = create_engine(
        str(settings.SQLALCHEMY_DATABASE_URI), pool_pre_ping=True, echo=echo
    )
    # SQLite ignores FK constraints unless this is set per-connection -- without
    # it, `subtopic.topic_id`/`organigram_unit.parent_id`/etc. would silently
    # accept dangling references instead of raising IntegrityError.
    if engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _configure_sqlite_connection)
    return engine


def get_session(echo: bool = False) -> Generator:
    engine = get_engine(echo=echo)
    session = Session(engine)
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
