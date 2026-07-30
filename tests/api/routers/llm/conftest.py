import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.api.endpoints.routers.llm import summarization
from aymurai.database.session import get_session


@pytest.fixture
def llm_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def llm_test_client(llm_engine):
    app = FastAPI()
    app.include_router(summarization.router, prefix="/llm")

    def _override_get_session():
        with Session(llm_engine) as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
