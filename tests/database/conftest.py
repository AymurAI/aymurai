import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.database.session import _enable_sqlite_foreign_keys


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    SQLModel.metadata.create_all(engine)
    return engine


@pytest.fixture
def session(engine):
    with Session(engine) as session:
        yield session
