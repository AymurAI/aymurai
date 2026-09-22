from collections.abc import Generator

from sqlalchemy import event
from sqlmodel import Session, create_engine

from aymurai.settings import settings


def _configure_sqlite_connection(dbapi_connection, connection_record) -> None:
    del connection_record
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    # WAL deja que los lectores nunca bloqueen al escritor (ni viceversa) --
    # sin esto, cualquier lectura concurrente con una escritura puede
    # devolver "database is locked" incluso para un SELECT.
    cursor.execute("PRAGMA journal_mode=WAL")
    # Con WAL, "database is locked" sólo puede pasar entre dos escritores
    # concurrentes. Este timeout hace que el segundo espere en vez de
    # fallar inmediatamente.
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
