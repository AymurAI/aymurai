import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.api.endpoints.routers.defensoria import organigram
from aymurai.database.session import _enable_sqlite_foreign_keys, get_session


@pytest.fixture
def organigram_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    SQLModel.metadata.create_all(engine)

    app = FastAPI()
    app.include_router(organigram.router, prefix="/organigram")

    def _override_get_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client

    engine.dispose()


def _create_unit(client, *, name="Unidad") -> str:
    response = client.post("/organigram/units", json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _appoint(client, unit_id, *, name, start_date=None) -> dict:
    payload = {"name": name}
    if start_date is not None:
        payload["start_date"] = start_date
    response = client.post(f"/organigram/units/{unit_id}/holders", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_term_can_start_before_the_record_was_created(organigram_client):
    unit_id = _create_unit(organigram_client)

    holder = _appoint(
        organigram_client, unit_id, name="Titular", start_date="2024-03-11"
    )

    assert holder["start_date"] == "2024-03-11"
    # The audit timestamp is untouched: it says when the row was written, and
    # the two are different facts once a history is entered after the fact.
    assert not holder["created_at"].startswith("2024-03-11")


def test_the_date_can_be_corrected_without_touching_the_name(organigram_client):
    unit_id = _create_unit(organigram_client)
    holder = _appoint(organigram_client, unit_id, name="Titular")

    response = organigram_client.patch(
        f"/organigram/holders/{holder['id']}", json={"start_date": "2024-03-11"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == holder["id"]
    assert body["name"] == "Titular"
    assert body["start_date"] == "2024-03-11"
    assert body["is_current"] is True


def test_correcting_a_past_holder_does_not_make_it_current(organigram_client):
    unit_id = _create_unit(organigram_client)
    first = _appoint(organigram_client, unit_id, name="Primero")
    _appoint(organigram_client, unit_id, name="Segundo")

    response = organigram_client.patch(
        f"/organigram/holders/{first['id']}",
        json={"name": "Primera", "start_date": "2020-01-01"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["is_current"] is False


def test_the_history_is_ordered_by_term_not_by_insert_order(organigram_client):
    unit_id = _create_unit(organigram_client)
    _appoint(organigram_client, unit_id, name="Medio", start_date="2018-05-01")
    _appoint(organigram_client, unit_id, name="Actual", start_date="2024-03-11")
    _appoint(organigram_client, unit_id, name="Primero", start_date="2010-01-01")

    response = organigram_client.get(f"/organigram/units/{unit_id}/holders")

    assert response.status_code == 200, response.text
    assert [h["name"] for h in response.json()] == ["Actual", "Medio", "Primero"]


def test_a_patch_that_corrects_nothing_is_refused(organigram_client):
    """Both fields are optional so a date-only correction is expressible; an
    empty body is a client mistake, not a 200."""
    unit_id = _create_unit(organigram_client)
    holder = _appoint(organigram_client, unit_id, name="Titular")

    response = organigram_client.patch(
        f"/organigram/holders/{holder['id']}", json={}
    )

    assert response.status_code == 422


def test_correcting_a_holder_that_does_not_exist_is_a_404(organigram_client):
    response = organigram_client.patch(
        "/organigram/holders/00000000-0000-0000-0000-000000000000",
        json={"name": "Nadie"},
    )

    assert response.status_code == 404
