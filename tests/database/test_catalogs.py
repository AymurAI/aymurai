from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from aymurai.database.crud.catalogs.subtopic import (
    subtopic_create,
    subtopic_deactivate,
    subtopic_list,
    subtopic_usage_count,
)
from aymurai.database.crud.catalogs.topic import (
    topic_create,
    topic_deactivate,
    topic_list,
    topic_usage_count,
)
from aymurai.database.schema import SubtopicCreate, TopicCreate
from aymurai.database.seed.catalogs import seed_catalogs, seed_macro_sectors

REPO_ROOT = Path(__file__).resolve().parents[2]
TAXONOMY_PATH = REPO_ROOT / "resources" / "llm" / "defensoria_taxonomy.json"


def _make_topic(session, code="ACC", name="Discapacidad"):
    return topic_create(TopicCreate(code=code, name=name), session)


def test_subtopic_requires_valid_topic_id(session):
    import uuid

    with pytest.raises(IntegrityError):
        subtopic_create(
            SubtopicCreate(topic_id=uuid.uuid4(), code="X1", name="huerfano"),
            session,
        )


def test_deactivate_topic_preserves_subtopic_reference(session):
    topic = _make_topic(session)
    subtopic = subtopic_create(
        SubtopicCreate(topic_id=topic.id, code="ACC1", name="Accesibilidad"), session
    )

    topic_deactivate(topic.id, session)

    # the subtopic row (and its FK to the now-inactive topic) is untouched
    still_there = session.get(type(subtopic), subtopic.id)
    assert still_there is not None
    assert still_there.topic_id == topic.id


def test_deactivating_topic_hides_its_subtopics_from_default_listing(session):
    topic = _make_topic(session)
    subtopic_create(
        SubtopicCreate(topic_id=topic.id, code="ACC1", name="Accesibilidad"), session
    )

    assert len(subtopic_list(session, topic_id=topic.id)) == 1

    topic_deactivate(topic.id, session)

    assert subtopic_list(session, topic_id=topic.id) == []
    assert len(subtopic_list(session, topic_id=topic.id, include_inactive=True)) == 1


def test_topic_usage_count_is_zero_before_recommendation_exists(session):
    topic = _make_topic(session)
    assert topic_usage_count(topic.id, session) == 0


def test_subtopic_usage_count_is_zero_before_recommendation_exists(session):
    topic = _make_topic(session)
    subtopic = subtopic_create(
        SubtopicCreate(topic_id=topic.id, code="ACC1", name="Accesibilidad"), session
    )
    assert subtopic_usage_count(subtopic.id, session) == 0


def test_deactivate_subtopic_preserves_row(session):
    topic = _make_topic(session)
    subtopic = subtopic_create(
        SubtopicCreate(topic_id=topic.id, code="ACC1", name="Accesibilidad"), session
    )

    deactivated = subtopic_deactivate(subtopic.id, session)

    assert deactivated.active is False
    assert session.get(type(subtopic), subtopic.id) is not None


@pytest.mark.integration
def test_seed_reproduces_25_topics_and_242_subtopics(session):
    if not TAXONOMY_PATH.exists():
        pytest.skip("defensoria_taxonomy.json not present (restricted data)")

    topic_count, subtopic_count = seed_catalogs(session, TAXONOMY_PATH)

    assert topic_count == 25
    assert subtopic_count == 242
    assert len(topic_list(session)) == 25


@pytest.mark.integration
def test_seed_catalogs_is_idempotent(session):
    if not TAXONOMY_PATH.exists():
        pytest.skip("defensoria_taxonomy.json not present (restricted data)")

    first = seed_catalogs(session, TAXONOMY_PATH)
    second = seed_catalogs(session, TAXONOMY_PATH)

    assert first == second == (25, 242)


def test_seed_macro_sectors_creates_exactly_four(session):
    count = seed_macro_sectors(session)
    assert count == 4

    # idempotent
    assert seed_macro_sectors(session) == 4


def test_duplicate_subtopic_name_within_topic_is_rejected(session):
    """uq_subtopic_topic_id_name lives in migration dd89f40c7c3e; the model
    must declare it too, or create_all-based tests silently allow duplicates."""
    topic = topic_create(TopicCreate(code="T1", name="Tema"), session)
    subtopic_create(SubtopicCreate(topic_id=topic.id, code="S1", name="Igual"), session)

    with pytest.raises(IntegrityError):
        subtopic_create(
            SubtopicCreate(topic_id=topic.id, code="S2", name="Igual"), session
        )
    session.rollback()
