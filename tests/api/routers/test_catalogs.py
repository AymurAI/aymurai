import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.api.endpoints.routers.defensoria import catalogs
from aymurai.database.session import _enable_sqlite_foreign_keys, get_session


@pytest.fixture
def catalogs_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    SQLModel.metadata.create_all(engine)

    app = FastAPI()
    app.include_router(catalogs.router, prefix="/catalogs")

    def _override_get_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client

    engine.dispose()


def _create_topic(client, *, code="T1", name="Tema") -> str:
    response = client.post("/catalogs/topics", json={"code": code, "name": name})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_duplicate_subtopic_name_conflict_names_the_name_not_the_code(catalogs_client):
    """The subtopic table has two unique constraints. A `(topic_id, name)`
    collision must be reported as a name conflict -- reporting it as a `code`
    conflict would send the client off to change the wrong field."""
    topic_id = _create_topic(catalogs_client)
    first = catalogs_client.post(
        "/catalogs/subtopics",
        json={"topic_id": topic_id, "code": "S1", "name": "Igual"},
    )
    assert first.status_code == 200, first.text

    response = catalogs_client.post(
        "/catalogs/subtopics",
        json={"topic_id": topic_id, "code": "S2", "name": "Igual"},
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "Igual" in detail
    assert "S2" not in detail


def test_duplicate_subtopic_code_conflict_still_names_the_code(catalogs_client):
    """The pre-existing `code` conflict message must be unchanged."""
    topic_id = _create_topic(catalogs_client)
    first = catalogs_client.post(
        "/catalogs/subtopics",
        json={"topic_id": topic_id, "code": "S1", "name": "Uno"},
    )
    assert first.status_code == 200, first.text

    response = catalogs_client.post(
        "/catalogs/subtopics",
        json={"topic_id": topic_id, "code": "S1", "name": "Distinto"},
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "S1" in detail
    assert "Distinto" not in detail
