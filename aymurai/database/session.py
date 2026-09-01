from collections.abc import Generator

from sqlalchemy import event
from sqlmodel import Session, create_engine

from aymurai.settings import settings


def _enable_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:
    del connection_record
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def get_engine(echo: bool = False):
    engine = create_engine(
        str(settings.SQLALCHEMY_DATABASE_URI), pool_pre_ping=True, echo=echo
    )
    # SQLite ignores FK constraints unless this is set per-connection -- without
    # it, `subtopic.topic_id`/`organigram_unit.parent_id`/etc. would silently
    # accept dangling references instead of raising IntegrityError.
    if engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    return engine


def get_session(echo: bool = False) -> Generator:
    engine = get_engine(echo=echo)
    session = Session(engine)
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
