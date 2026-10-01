from sqlmodel import Session, text

from aymurai.database.session import get_engine
from aymurai.settings import settings


def test_sqlite_connection_has_wal_and_busy_timeout(tmp_path, monkeypatch):
    # WAL only takes effect on a real file -- an in-memory `sqlite://` engine
    # silently stays in "memory" journal mode, so this needs a file-backed DB
    # (same pattern as tests/api/routers/server/test_frontend.py).
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(settings, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{db_path}")

    engine = get_engine()
    try:
        with Session(engine) as session:
            # `Session.exec` is typed for `Select`/`SelectOfScalar` only; raw PRAGMA
            # text goes through the underlying `execute` instead.
            journal_mode = session.execute(text("PRAGMA journal_mode")).scalar()
            busy_timeout = session.execute(text("PRAGMA busy_timeout")).scalar()
    finally:
        engine.dispose()

    assert journal_mode == "wal"
    assert busy_timeout == 5000


def test_sqlite_connection_registers_normalize_text(tmp_path, monkeypatch):
    # The listing search folds case and accents in SQL; SQLite's built-in
    # `lower()` only folds ASCII, so every connection must carry the Python
    # normalization as a SQL function.
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(settings, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{db_path}")

    engine = get_engine()
    try:
        with engine.connect() as connection:
            folded = connection.execute(
                text("SELECT normalize_text('ÁREA Ñandú')")
            ).scalar()
            null = connection.execute(text("SELECT normalize_text(NULL)")).scalar()
    finally:
        engine.dispose()

    assert folded == "area nandu"
    assert null is None
