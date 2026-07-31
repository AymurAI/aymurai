import json
from unittest.mock import AsyncMock, patch

from aymurai.llm_providers import LLMResponse


def _parse_sse(body: str) -> list[dict]:
    events = []
    for block in body.split("\n\n"):
        block = block.strip()
        if not block.startswith("data:"):
            continue
        events.append(json.loads(block[len("data:") :].strip()))
    return events


def test_summarize_rejects_empty_text(llm_test_client):
    response = llm_test_client.post("/llm/summarize", json={"text": "   "})
    assert response.status_code == 400


def test_summarize_rejects_non_positive_num_ctx(llm_test_client):
    response = llm_test_client.post(
        "/llm/summarize",
        json={"text": "hola", "options": {"num_ctx": 0}},
    )
    assert response.status_code == 400


def test_summarize_returns_summary_from_single_chunk(llm_test_client):
    fake_response = LLMResponse(text="Resumen generado.", metadata={})

    with patch(
        "aymurai.llm_providers.OllamaLLMProvider.async_generate",
        new=AsyncMock(return_value=fake_response),
    ):
        response = llm_test_client.post(
            "/llm/summarize",
            json={"text": "Texto de entrada corto a resumir."},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == "Resumen generado."
    assert body["model"] == "gpt-oss:20b"
    assert body["chunks_used"] == 1
    assert len(body["steps"]) == 1


def test_summarize_uses_requested_model_and_options(llm_test_client):
    fake_response = LLMResponse(text="ok", metadata={})

    with patch(
        "aymurai.llm_providers.OllamaLLMProvider.async_generate",
        new=AsyncMock(return_value=fake_response),
    ) as mock_generate:
        response = llm_test_client.post(
            "/llm/summarize",
            json={
                "text": "hola",
                "model": "phi4:14b",
                "options": {"num_ctx": 8192, "num_predict": 512},
            },
        )

    assert response.status_code == 200
    assert response.json()["model"] == "phi4:14b"
    assert response.json()["options"]["num_ctx"] == 8192
    _, kwargs = mock_generate.call_args
    assert kwargs["options"]["num_predict"] == 512


def test_summarize_stream_emits_meta_token_and_summary_events(llm_test_client):
    async def fake_stream(self, prompt, **kwargs):
        for piece in ["Hola", " mundo"]:
            yield LLMResponse(text=piece, metadata={})

    with patch(
        "aymurai.llm_providers.OllamaLLMProvider.async_stream",
        new=fake_stream,
    ):
        response = llm_test_client.post(
            "/llm/summarize/stream",
            json={"text": "Texto corto."},
        )

    assert response.status_code == 200
    events = _parse_sse(response.text)
    types = [event["type"] for event in events]
    assert types[0] == "meta"
    assert "token" in types
    assert types[-1] == "summary"
    summary_event = events[-1]
    assert summary_event["summary"] == "Hola mundo"


def test_llm_test_client_has_a_working_summarization_table(llm_test_client, llm_engine):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid

    document_id = text_to_uuid("fixture-check")
    with Session(llm_engine) as session:
        session.add(
            Summarization(
                id=document_id,
                title=None,
                text="fixture-check",
                summary="ok",
                validation=None,
                config={},
                steps=[],
                chunks_used=1,
            )
        )
        session.commit()

    with Session(llm_engine) as session:
        assert session.get(Summarization, document_id) is not None


def test_summarize_persists_record_and_returns_document_id_and_config(
    llm_test_client, llm_engine
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid

    text = "Texto de entrada a persistir."
    document_id = text_to_uuid(text)
    fake_response = LLMResponse(text="Resumen persistido.", metadata={})

    with patch(
        "aymurai.llm_providers.OllamaLLMProvider.async_generate",
        new=AsyncMock(return_value=fake_response),
    ):
        response = llm_test_client.post("/llm/summarize", json={"text": text})

    assert response.status_code == 200
    body = response.json()
    assert body["document_id"] == str(document_id)
    assert body["summary"] == "Resumen persistido."
    assert body["config"]["model"] == "gpt-oss:20b"
    assert body["config"]["options"]["num_ctx"] == 16384
    assert body["config"]["system_prompt"]

    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record is not None
        assert record.text == text
        assert record.summary == "Resumen persistido."
        assert record.config["model"] == "gpt-oss:20b"
        assert record.chunks_used == 1
        assert record.validation is None


def test_summarize_cache_hit_returns_stored_summary_without_calling_provider(
    llm_test_client, llm_engine
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid

    text = "Texto ya resumido previamente."
    document_id = text_to_uuid(text)

    with Session(llm_engine) as session:
        session.add(
            Summarization(
                id=document_id,
                title="Cacheado",
                text=text,
                summary="# Resumen cacheado",
                validation=None,
                config={
                    "model": "phi4:14b",
                    "system_prompt": "prompt viejo",
                    "tokenizer": "o200k_harmony",
                    "options": {"num_ctx": 8192},
                },
                steps=[{"chunk_index": 0, "input_tokens": 3, "source": "chunk"}],
                chunks_used=1,
            )
        )
        session.commit()

    def _fail(*args, **kwargs):
        raise AssertionError("the provider must not be called on a cache hit")

    with patch(
        "aymurai.llm_providers.OllamaLLMProvider.async_generate",
        new=_fail,
    ):
        response = llm_test_client.post("/llm/summarize", json={"text": text})

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == "# Resumen cacheado"
    assert body["document_id"] == str(document_id)
    # Config is stored and returned as-is; it is never compared against the request.
    assert body["config"]["model"] == "phi4:14b"
    assert body["model"] == "phi4:14b"


def test_summarize_with_use_cache_false_regenerates_and_clears_validation(
    llm_test_client, llm_engine
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid

    text = "Texto a regenerar."
    document_id = text_to_uuid(text)

    with Session(llm_engine) as session:
        session.add(
            Summarization(
                id=document_id,
                title="Viejo",
                text=text,
                summary="# Resumen viejo",
                validation={"type": "doc", "content": []},
                config={
                    "model": "phi4:14b",
                    "system_prompt": "prompt viejo",
                    "tokenizer": None,
                    "options": {"num_ctx": 8192},
                },
                steps=[],
                chunks_used=1,
            )
        )
        session.commit()

    fake_response = LLMResponse(text="# Resumen nuevo", metadata={})

    with patch(
        "aymurai.llm_providers.OllamaLLMProvider.async_generate",
        new=AsyncMock(return_value=fake_response),
    ):
        response = llm_test_client.post(
            "/llm/summarize?use_cache=false", json={"text": text}
        )

    assert response.status_code == 200
    assert response.json()["summary"] == "# Resumen nuevo"

    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record.summary == "# Resumen nuevo"
        assert record.validation is None
        assert record.config["model"] == "gpt-oss:20b"


def test_summarize_stream_meta_event_carries_document_id(llm_test_client):
    from aymurai.database.utils import text_to_uuid

    text = "Texto corto para streaming meta."
    document_id = text_to_uuid(text)

    async def fake_stream(self, prompt, **kwargs):
        from aymurai.llm_providers import LLMResponse as _LLMResponse

        for piece in ["Hola", " mundo"]:
            yield _LLMResponse(text=piece, metadata={})

    with patch(
        "aymurai.llm_providers.OllamaLLMProvider.async_stream",
        new=fake_stream,
    ):
        response = llm_test_client.post("/llm/summarize/stream", json={"text": text})

    assert response.status_code == 200
    events = _parse_sse(response.text)
    assert events[0]["type"] == "meta"
    assert events[0]["document_id"] == str(document_id)


def test_summarize_stream_persists_on_terminal_summary_event(
    llm_test_client, llm_engine
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid

    text = "Texto corto para persistir por stream."
    document_id = text_to_uuid(text)

    async def fake_stream(self, prompt, **kwargs):
        from aymurai.llm_providers import LLMResponse as _LLMResponse

        for piece in ["Resumen", " streamed"]:
            yield _LLMResponse(text=piece, metadata={})

    with patch(
        "aymurai.llm_providers.OllamaLLMProvider.async_stream",
        new=fake_stream,
    ):
        response = llm_test_client.post("/llm/summarize/stream", json={"text": text})

    assert response.status_code == 200
    events = _parse_sse(response.text)
    assert events[-1]["type"] == "summary"
    assert events[-1]["summary"] == "Resumen streamed"

    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record is not None
        assert record.text == text
        assert record.summary == "Resumen streamed"
        assert record.chunks_used == 1
        assert record.config["model"] == "gpt-oss:20b"
        assert record.validation is None


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
