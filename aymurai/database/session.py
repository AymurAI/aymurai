from collections.abc import Generator

from sqlalchemy import event
from sqlmodel import Session, create_engine

from aymurai.settings import settings


def _configure_sqlite_connection(dbapi_connection, connection_record) -> None:
    del connection_record
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    # WAL lets readers never block the writer (or vice versa) -- without
    # this, any read concurrent with a write could return "database is
    # locked" even for a SELECT.
    cursor.execute("PRAGMA journal_mode=WAL")
    # With WAL, "database is locked" can only happen between two concurrent
    # writers, and the second one waits up to busy_timeout before failing.
    # sqlite3.connect() already sets a 5s timeout by default; this pragma
    # makes the wait configurable via SQLITE_BUSY_TIMEOUT_MS.
    cursor.execute(f"PRAGMA busy_timeout={settings.SQLITE_BUSY_TIMEOUT_MS}")
    cursor.close()


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
