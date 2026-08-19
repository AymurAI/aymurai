from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.database.schema import Summarization
from aymurai.database.utils import text_to_uuid


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_table_name_is_llm_summarization():
    assert Summarization.__tablename__ == "llm_summarization"


def test_row_roundtrips_all_columns():
    engine = _engine()
    document_id = text_to_uuid("un texto de prueba")

    with Session(engine) as session:
        session.add(
            Summarization(
                id=document_id,
                title="Causa 123",
                text="un texto de prueba",
                summary="# Resumen\n\nContenido.",
                validation=None,
                config={"model": "gpt-oss:20b", "options": {"num_ctx": 16384}},
                steps=[{"chunk_index": 0, "input_tokens": 12, "source": "chunk"}],
                chunks_used=1,
            )
        )
        session.commit()

    with Session(engine) as session:
        record = session.get(Summarization, document_id)
        assert record is not None
        assert record.title == "Causa 123"
        assert record.text == "un texto de prueba"
        assert record.summary == "# Resumen\n\nContenido."
        assert record.validation is None
        assert record.config["model"] == "gpt-oss:20b"
        assert record.steps[0]["chunk_index"] == 0
        assert record.chunks_used == 1
        assert record.created_at is not None


def test_validation_accepts_a_tiptap_json_document():
    engine = _engine()
    document_id = text_to_uuid("otro texto")
    tiptap = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "editado", "marks": [{"type": "bold"}]}
                ],
            }
        ],
    }

    with Session(engine) as session:
        session.add(
            Summarization(
                id=document_id,
                title=None,
                text="otro texto",
                summary="resumen",
                validation=tiptap,
                config={},
                steps=[],
                chunks_used=1,
            )
        )
        session.commit()

    with Session(engine) as session:
        record = session.get(Summarization, document_id)
        assert (
            record.validation["content"][0]["content"][0]["marks"][0]["type"] == "bold"
        )
