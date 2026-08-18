from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from aymurai.api.endpoints.routers.llm.summarization_engine import DoneEvent, TokenEvent
from tests.api.routers.llm.conftest import (
    fake_llamacpp_network,
    fake_prepare_run,
    parse_sse,
    patched_generation,
)


def test_summarize_stream_emits_meta_token_and_summary_events(llm_test_client):
    events = [
        TokenEvent(chunk_index=0, source="chunk", text="Hola"),
        TokenEvent(chunk_index=0, source="chunk", text=" mundo"),
        DoneEvent(summary="Hola mundo", chunks_used=1),
    ]

    with patched_generation(events):
        response = llm_test_client.post(
            "/llm/summarize/stream",
            json={"text": "Texto corto."},
        )

    assert response.status_code == 200
    events_out = parse_sse(response.text)
    types = [event["type"] for event in events_out]
    assert types[0] == "meta"
    assert "token" in types
    assert types[-1] == "summary"
    summary_event = events_out[-1]
    assert summary_event["summary"] == "Hola mundo"


def test_summarize_stream_meta_event_carries_document_id(llm_test_client):
    from aymurai.database.utils import text_to_uuid

    text = "Texto corto para streaming meta."
    document_id = text_to_uuid(text)
    events = [
        TokenEvent(chunk_index=0, source="chunk", text="Hola"),
        TokenEvent(chunk_index=0, source="chunk", text=" mundo"),
        DoneEvent(summary="Hola mundo", chunks_used=1),
    ]

    with patched_generation(events):
        response = llm_test_client.post("/llm/summarize/stream", json={"text": text})

    assert response.status_code == 200
    events_out = parse_sse(response.text)
    assert events_out[0]["type"] == "meta"
    assert events_out[0]["document_id"] == str(document_id)


def test_summarize_stream_persists_on_terminal_summary_event(
    llm_test_client, llm_engine
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid

    text = "Texto corto para persistir por stream."
    document_id = text_to_uuid(text)
    events = [
        TokenEvent(chunk_index=0, source="chunk", text="Resumen"),
        TokenEvent(chunk_index=0, source="chunk", text=" streamed"),
        DoneEvent(summary="Resumen streamed", chunks_used=1),
    ]

    with patched_generation(events):
        response = llm_test_client.post("/llm/summarize/stream", json={"text": text})

    assert response.status_code == 200
    events_out = parse_sse(response.text)
    assert events_out[-1]["type"] == "summary"
    assert events_out[-1]["summary"] == "Resumen streamed"

    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record is not None
        assert record.text == text
        assert record.summary == "Resumen streamed"
        assert record.chunks_used == 1
        assert record.config["model"] == "/models/fake-served.gguf"
        assert record.validation is None


def test_summarize_stream_cache_hit_replays_stored_summary_and_preserves_validation(
    llm_test_client, llm_engine
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid

    text = "Texto ya resumido para stream."
    document_id = text_to_uuid(text)
    stored_validation = {"type": "doc", "content": [{"type": "paragraph"}]}

    with Session(llm_engine) as session:
        session.add(
            Summarization(
                id=document_id,
                title="Cacheado",
                text=text,
                summary="# Resumen cacheado",
                validation=stored_validation,
                config={
                    "model": "phi4:14b",
                    "system_prompt": "prompt viejo",
                    "tokenizer": None,
                    "options": {"num_ctx": 8192},
                },
                steps=[{"chunk_index": 0, "input_tokens": 3, "source": "chunk"}],
                chunks_used=1,
            )
        )
        session.commit()

    # `prepare_run` still runs unconditionally before the cache check (same as
    # before this task), but generation itself must never be reached.
    async def _fail_events(*args, **kwargs):
        raise AssertionError("generation must not run on a stream cache hit")
        yield  # pragma: no cover -- unreachable; keeps this an async generator

    with (
        patch(
            "aymurai.api.endpoints.routers.llm.summarization.prepare_run",
            new=fake_prepare_run(),
        ),
        patch(
            "aymurai.api.endpoints.routers.llm.summarization.summarize_events",
            new=_fail_events,
        ),
    ):
        response = llm_test_client.post("/llm/summarize/stream", json={"text": text})

    assert response.status_code == 200
    events = parse_sse(response.text)
    assert events[0]["type"] == "meta"
    assert events[0]["document_id"] == str(document_id)
    assert events[0]["model"] == "phi4:14b"
    assert events[-1]["type"] == "summary"
    assert events[-1]["summary"] == "# Resumen cacheado"

    # A cache-hit re-stream must NOT clear the stored human validation.
    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record.validation == stored_validation
        assert record.summary == "# Resumen cacheado"


def test_summarize_stream_use_cache_false_regenerates_and_clears_validation(
    llm_test_client, llm_engine
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid

    text = "Texto a regenerar por stream."
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

    events = [
        TokenEvent(chunk_index=0, source="chunk", text="# "),
        TokenEvent(chunk_index=0, source="chunk", text="Resumen nuevo"),
        DoneEvent(summary="# Resumen nuevo", chunks_used=1),
    ]

    with patched_generation(events):
        response = llm_test_client.post(
            "/llm/summarize/stream?use_cache=false", json={"text": text}
        )

    assert response.status_code == 200
    events_out = parse_sse(response.text)
    assert events_out[-1]["type"] == "summary"
    assert events_out[-1]["summary"] == "# Resumen nuevo"

    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record.summary == "# Resumen nuevo"
        assert record.validation is None
        assert record.config["model"] == "/models/fake-served.gguf"


def test_summarize_stream_closes_the_client_after_the_stream_completes(
    llm_test_client, monkeypatch
):
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    mock_openai_client, mock_raw_client = fake_llamacpp_network()

    async def _stream():
        yield SimpleNamespace(
            choices=[
                SimpleNamespace(
                    delta=SimpleNamespace(content="Resumen."),
                    finish_reason="stop",
                )
            ]
        )

    mock_openai_client.chat.completions.create = AsyncMock(return_value=_stream())

    with (
        patch(
            "aymurai.llm_providers.openai_compatible_provider.AsyncOpenAI",
            return_value=mock_openai_client,
        ),
        patch(
            "aymurai.llm_providers.llamacpp_provider.httpx.AsyncClient",
            return_value=mock_raw_client,
        ),
    ):
        response = llm_test_client.post(
            "/llm/summarize/stream",
            json={"text": "Texto corto para stream close."},
        )

    assert response.status_code == 200
    mock_openai_client.close.assert_awaited_once()
