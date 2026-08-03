from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.database.crud.summarization import (
    summarization_create_or_update,
    summarization_get,
)
from aymurai.database.utils import text_to_uuid


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_create_or_update_creates_new_record_when_missing():
    engine = _engine()
    summarization_id = text_to_uuid("doc-1")

    with Session(engine) as session:
        record = summarization_create_or_update(
            summarization_id=summarization_id,
            text="doc-1",
            summary="# Resumen 1",
            config={"model": "gpt-oss:20b", "options": {"num_ctx": 16384}},
            steps=[{"chunk_index": 0, "input_tokens": 5, "source": "chunk"}],
            chunks_used=1,
            session=session,
            title="Causa 1",
        )
        assert record.id == summarization_id
        assert record.title == "Causa 1"
        assert record.text == "doc-1"
        assert record.summary == "# Resumen 1"
        assert record.config["model"] == "gpt-oss:20b"
        assert record.steps[0]["source"] == "chunk"
        assert record.chunks_used == 1
        assert record.validation is None


def test_get_returns_none_when_not_found():
    engine = _engine()
    with Session(engine) as session:
        assert summarization_get(text_to_uuid("missing"), session) is None


def test_get_returns_record_when_present():
    engine = _engine()
    summarization_id = text_to_uuid("doc-2")

    with Session(engine) as session:
        summarization_create_or_update(
            summarization_id=summarization_id,
            text="doc-2",
            summary="# Resumen 2",
            config={},
            steps=[],
            chunks_used=1,
            session=session,
        )

    with Session(engine) as session:
        record = summarization_get(summarization_id, session)
        assert record is not None
        assert record.summary == "# Resumen 2"
        assert record.title is None


def test_create_or_update_overwrites_existing_record_and_clears_validation():
    engine = _engine()
    summarization_id = text_to_uuid("doc-3")

    with Session(engine) as session:
        record = summarization_create_or_update(
            summarization_id=summarization_id,
            text="doc-3",
            summary="# Primero",
            config={"model": "a"},
            steps=[],
            chunks_used=1,
            session=session,
            title="Primero",
        )
        record.validation = {"type": "doc", "content": []}
        session.add(record)
        session.commit()

    with Session(engine) as session:
        updated = summarization_create_or_update(
            summarization_id=summarization_id,
            text="doc-3",
            summary="# Segundo",
            config={"model": "b"},
            steps=[{"chunk_index": 0, "input_tokens": 9, "source": "chunk"}],
            chunks_used=2,
            session=session,
            title="Segundo",
        )
        assert updated.summary == "# Segundo"
        assert updated.title == "Segundo"
        assert updated.config["model"] == "b"
        assert updated.chunks_used == 2
        assert updated.validation is None
