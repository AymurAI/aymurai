import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.api.endpoints.routers.defensoria import catalogs
from aymurai.database.session import _configure_sqlite_connection, get_session


@pytest.fixture
def catalogs_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine, "connect", _configure_sqlite_connection)
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


def _create_subtopic(client, topic_id, *, code, name) -> str:
    response = client.post(
        "/catalogs/subtopics",
        json={"topic_id": topic_id, "code": code, "name": name},
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_rename_keeps_the_topic_id_so_tagged_records_are_untouched(catalogs_client):
    """Fixing a typo must correct the record, not replace it: dropping and
    recreating a topic would orphan every document tagged with the old id."""
    topic_id = _create_topic(catalogs_client, code="EDU", name="EDUCACION")

    response = catalogs_client.patch(
        f"/catalogs/topics/{topic_id}", json={"name": "EDUCACIÓN"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == topic_id
    assert body["name"] == "EDUCACIÓN"
    assert body["code"] == "EDU"
    assert body["active"] is True


def test_rename_keeps_the_subtopic_id_and_its_topic(catalogs_client):
    topic_id = _create_topic(catalogs_client)
    subtopic_id = _create_subtopic(
        catalogs_client, topic_id, code="S1", name="Patrocinio"
    )

    response = catalogs_client.patch(
        f"/catalogs/subtopics/{subtopic_id}", json={"name": "Patrocinio jurídico"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == subtopic_id
    assert body["topic_id"] == topic_id
    assert body["name"] == "Patrocinio jurídico"


def test_renaming_a_subtopic_onto_a_sibling_name_conflicts(catalogs_client):
    """`(topic_id, name)` is unique, so this is reachable by rename as well as
    by create -- and used to surface as a 500 rather than a 409."""
    topic_id = _create_topic(catalogs_client)
    _create_subtopic(catalogs_client, topic_id, code="S1", name="Igual")
    other_id = _create_subtopic(catalogs_client, topic_id, code="S2", name="Distinto")

    response = catalogs_client.patch(
        f"/catalogs/subtopics/{other_id}", json={"name": "Igual"}
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "Igual" in detail
    assert "S2" not in detail


def test_the_same_name_under_another_topic_is_not_a_conflict(catalogs_client):
    """The constraint is scoped to the topic: two topics may each have a
    subtopic called "General"."""
    first_topic = _create_topic(catalogs_client, code="T1", name="Uno")
    second_topic = _create_topic(catalogs_client, code="T2", name="Dos")
    _create_subtopic(catalogs_client, first_topic, code="S1", name="General")
    movable = _create_subtopic(catalogs_client, second_topic, code="S2", name="Otro")

    response = catalogs_client.patch(
        f"/catalogs/subtopics/{movable}", json={"name": "General"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "General"
