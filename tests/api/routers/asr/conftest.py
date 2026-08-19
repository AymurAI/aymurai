import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.api.endpoints.routers.asr import transcribe
from aymurai.database.session import get_session
from aymurai.settings import settings


@pytest.fixture
def asr_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def asr_test_client(asr_engine, monkeypatch):
    app = FastAPI()
    app.include_router(transcribe.router, prefix="/asr")

    def _override_get_session():
        with Session(asr_engine) as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session
    monkeypatch.setattr(settings, "TRANSCRIBE_BASE_URL", "http://test-coro.local/v1")

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, asr_engine
