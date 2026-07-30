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
