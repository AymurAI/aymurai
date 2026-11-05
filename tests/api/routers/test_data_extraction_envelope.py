import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session, SQLModel, StaticPool, create_engine, select

from aymurai.api.endpoints.routers.defensoria import data_extraction
from aymurai.api.endpoints.routers.llm.data_extraction_engine import catalogs_hash
from aymurai.database.crud.catalogs.macro_sector import macro_sector_list
from aymurai.database.crud.catalogs.subtopic import subtopic_create, subtopic_list
from aymurai.database.crud.catalogs.topic import topic_create, topic_list
from aymurai.database.crud.llm_extraction import llm_extraction_create_or_update
from aymurai.database.crud.recommendation import (
    RecipientValidationData,
    RecommendationValidationData,
    recommendation_upsert,
)
from aymurai.database.schema import (
    LLMExtraction,
    Recommendation,
    SubtopicCreate,
    Topic,
    TopicCreate,
)
from aymurai.database.seed.catalogs import seed_macro_sectors
from aymurai.database.session import _configure_sqlite_connection, get_session


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine, "connect", _configure_sqlite_connection)
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session(engine):
    with Session(engine) as session:
        yield session


@pytest.fixture
def client(engine):
    app = FastAPI()
    app.include_router(data_extraction.router, prefix="/api/llm")

    def _override_get_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def _catalogs_snapshot(session: Session) -> tuple[dict[str, list[str]], list[str]]:
    """Mirrors the router's own `_catalogs_snapshot` so a fixture-computed
    hash matches whatever the endpoint recomputes against the live catalogs."""
    topics = {
        topic.name: [sub.name for sub in subtopic_list(session, topic_id=topic.id)]
        for topic in topic_list(session)
    }
    macro_sector_names = [m.name for m in macro_sector_list(session)]
    return topics, macro_sector_names


@pytest.fixture
def seeded_catalogs(session) -> Topic:
    """One topic/subtopic pair plus the 4 fixed macro sectors, committed."""
    topic = topic_create(TopicCreate(code="SALUD", name="SALUD"), session)
    subtopic_create(
        SubtopicCreate(topic_id=topic.id, code="SALUD1", name="Hospitales"), session
    )
    seed_macro_sectors(session)
    return topic


@pytest.fixture
def stored_extraction(session, seeded_catalogs) -> LLMExtraction:
    """An extraction persisted straight through the CRUD layer -- no HTTP,
    no LLM -- with `config.catalogs_hash` set to the hash of the live
    catalogs snapshot, exactly as a fresh inference would compute it."""
    topics, macro_sector_names = _catalogs_snapshot(session)
    prediction = {
        "recommendation_number": "12/2022",
        "recommendation_date": "01 de enero de 2022",
        "recipients": [
            {
                "name": "Juan Perez",
                "position": "Director",
                "is_primary": True,
                "macro_sector": "GCBA",
            }
        ],
        "topic": "SALUD",
        "subtopic": "Hospitales",
        "personal_data": False,
        "publishable_content": "Resumen.",
    }
    config = {
        "model": "fake-model",
        "options": {"max_tokens": 1024, "attempts": 1},
        "catalogs_hash": catalogs_hash(topics, macro_sector_names),
    }
    document_id = uuid.uuid4()
    return llm_extraction_create_or_update(
        document_id, None, "Texto fuente.", prediction, config, session
    )


@pytest.fixture
def validated_recommendation(session, stored_extraction) -> Recommendation:
    """A human validation on top of `stored_extraction`, written straight
    through `recommendation_upsert` -- exactly what `PUT .../validate` does."""
    data = RecommendationValidationData(
        recommendation_number="12/2022",
        recommendation_date_text="01 de enero de 2022",
        topic="SALUD",
        subtopic="Hospitales",
        personal_data=False,
        publishable_content="Resumen.",
        recipients=[
            RecipientValidationData(
                id=None,
                name="Juan Perez",
                position="Director",
                is_primary=True,
                macro_sector="GCBA",
                unit_id=None,
                sector_id=None,
                source_index=0,
            )
        ],
    )
    return recommendation_upsert(stored_extraction.id, data, session)


def test_envelope_is_empty_for_an_unknown_document(client):
    """A document nobody processed yet answers 200 with both slots null.

    404 would be wrong: the question is "do you have anything for this?", and
    "no" is a valid answer the process screen acts on by running an extraction.
    """
    document_id = uuid.uuid4()
    response = client.get(f"/api/llm/data-extraction/{document_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["document_id"] == str(document_id)
    assert body["prediction"] is None
    assert body["validation"] is None
    assert body["catalogs_stale"] is False


def test_envelope_carries_the_stored_prediction(client, session, stored_extraction):
    """An extraction with no validation yet: prediction only."""
    response = client.get(f"/api/llm/data-extraction/{stored_extraction.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["prediction"] is not None
    assert body["prediction"]["document_id"] == str(stored_extraction.id)
    assert body["validation"] is None


def test_envelope_carries_both_once_validated(
    client, session, validated_recommendation
):
    """Once a human validated, both slots are populated.

    The process screen shows values from `validation` and keeps `prediction`
    for the frozen suggestions and the document highlighting.
    """
    document_id = validated_recommendation.document_id
    response = client.get(f"/api/llm/data-extraction/{document_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["prediction"] is not None
    assert body["validation"] is not None
    assert body["validation"]["document_id"] == str(document_id)


def test_catalogs_stale_flips_when_the_taxonomy_changes(
    client, session, stored_extraction
):
    """Renaming a topic must mark every prior extraction as stale.

    The UI offers to re-extract; it never re-infers on its own.
    """
    before = client.get(f"/api/llm/data-extraction/{stored_extraction.id}").json()
    assert before["catalogs_stale"] is False

    topic = session.exec(select(Topic)).first()
    topic.name = f"{topic.name} (renombrado)"
    session.add(topic)
    session.commit()

    after = client.get(f"/api/llm/data-extraction/{stored_extraction.id}").json()
    assert after["catalogs_stale"] is True
