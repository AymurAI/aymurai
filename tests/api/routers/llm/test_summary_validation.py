TIPTAP_DOC = {
    "type": "doc",
    "content": [
        {
            "type": "paragraph",
            "content": [
                {
                    "type": "text",
                    "text": "resumen editado",
                    "marks": [{"type": "highlight", "attrs": {"color": "#ffee00"}}],
                }
            ],
        }
    ],
}


def _seed_summarization(engine, text, summary="# Resumen", title=None, validation=None):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid

    document_id = text_to_uuid(text)
    with Session(engine) as session:
        session.add(
            Summarization(
                id=document_id,
                title=title,
                text=text,
                summary=summary,
                validation=validation,
                config={
                    "model": "gpt-oss:20b",
                    "system_prompt": "prompt",
                    "tokenizer": "o200k_harmony",
                    "options": {"num_ctx": 16384},
                },
                steps=[{"chunk_index": 0, "input_tokens": 7, "source": "chunk"}],
                chunks_used=1,
            )
        )
        session.commit()
    return document_id


def test_summarize_validation_get_returns_404_when_missing(llm_test_client):
    from aymurai.database.utils import text_to_uuid

    missing_id = text_to_uuid("nunca-resumido")
    response = llm_test_client.get(f"/llm/summarize/validation/document/{missing_id}")
    assert response.status_code == 404


def test_summarize_validation_post_returns_404_when_missing(llm_test_client):
    from aymurai.database.utils import text_to_uuid

    missing_id = text_to_uuid("nunca-resumido-tampoco")
    response = llm_test_client.post(
        f"/llm/summarize/validation/document/{missing_id}",
        json={"title": "X", "validation": TIPTAP_DOC},
    )
    assert response.status_code == 404


def test_summarize_validation_get_returns_both_summary_and_validation(
    llm_test_client, llm_engine
):
    document_id = _seed_summarization(
        llm_engine,
        "texto con validacion",
        summary="# Resumen original",
        title="Causa 7",
        validation=TIPTAP_DOC,
    )

    response = llm_test_client.get(f"/llm/summarize/validation/document/{document_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["document_id"] == str(document_id)
    assert body["title"] == "Causa 7"
    assert body["text"] == "texto con validacion"
    # Both fields are returned; the client decides which one to render.
    assert body["summary"] == "# Resumen original"
    assert body["validation"] == TIPTAP_DOC
    assert body["config"]["model"] == "gpt-oss:20b"
    assert body["chunks_used"] == 1
    assert body["steps"][0]["source"] == "chunk"


def test_summarize_validation_get_returns_null_validation_when_unvalidated(
    llm_test_client, llm_engine
):
    document_id = _seed_summarization(
        llm_engine, "texto sin validacion", summary="# Solo maquina"
    )

    response = llm_test_client.get(f"/llm/summarize/validation/document/{document_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == "# Solo maquina"
    assert body["validation"] is None


def test_summarize_validation_post_then_get_roundtrip(llm_test_client, llm_engine):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization

    document_id = _seed_summarization(llm_engine, "texto para roundtrip")

    post_response = llm_test_client.post(
        f"/llm/summarize/validation/document/{document_id}",
        json={"title": "Titulo nuevo", "validation": TIPTAP_DOC},
    )
    assert post_response.status_code == 200

    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record.title == "Titulo nuevo"
        assert record.validation == TIPTAP_DOC
        # Saving a validation never touches the machine-generated summary.
        assert record.summary == "# Resumen"

    get_response = llm_test_client.get(
        f"/llm/summarize/validation/document/{document_id}"
    )
    assert get_response.status_code == 200
    assert get_response.json()["validation"] == TIPTAP_DOC
    assert get_response.json()["title"] == "Titulo nuevo"


def test_summarize_validation_post_without_title_keeps_existing_title(
    llm_test_client, llm_engine
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization

    document_id = _seed_summarization(
        llm_engine, "texto con titulo previo", title="Titulo previo"
    )

    response = llm_test_client.post(
        f"/llm/summarize/validation/document/{document_id}",
        json={"validation": TIPTAP_DOC},
    )
    assert response.status_code == 200

    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record.title == "Titulo previo"
        assert record.validation == TIPTAP_DOC
