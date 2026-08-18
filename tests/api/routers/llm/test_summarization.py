from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from aymurai.api.endpoints.routers.llm.summarization_engine import (
    DoneEvent,
    StepEvent,
    SummarizationStep,
)
from tests.api.routers.llm.conftest import fake_llamacpp_network, patched_generation


def test_summarize_rejects_empty_text(llm_test_client):
    response = llm_test_client.post("/llm/summarize", json={"text": "   "})
    assert response.status_code == 400


def test_summarize_rejects_non_positive_max_tokens(llm_test_client):
    response = llm_test_client.post(
        "/llm/summarize",
        json={"text": "hola", "options": {"max_tokens": 0}},
    )
    assert response.status_code == 422


def test_summarize_returns_summary_from_single_chunk(llm_test_client):
    events = [
        StepEvent(
            step=SummarizationStep(chunk_index=0, input_tokens=5, source="chunk")
        ),
        DoneEvent(summary="Resumen generado.", chunks_used=1),
    ]

    with patched_generation(events):
        response = llm_test_client.post(
            "/llm/summarize",
            json={"text": "Texto de entrada corto a resumir."},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == "Resumen generado."
    assert body["model"] == "/models/fake-served.gguf"
    assert body["chunks_used"] == 1
    assert len(body["steps"]) == 1


def test_summarize_uses_requested_model_and_options(llm_test_client):
    events = [DoneEvent(summary="ok", chunks_used=1)]
    prepare_calls, event_calls = [], []

    with patched_generation(
        events, prepare_calls=prepare_calls, event_calls=event_calls
    ):
        response = llm_test_client.post(
            "/llm/summarize",
            json={
                "text": "hola",
                "model": "phi4:14b",
                "options": {"max_tokens": 512},
            },
        )

    assert response.status_code == 200
    assert response.json()["model"] == "phi4:14b"
    assert response.json()["options"]["max_tokens"] == 512
    assert prepare_calls[0]["model"] == "phi4:14b"
    assert prepare_calls[0]["max_tokens"] == 512
    assert event_calls[0]["options"]["max_tokens"] == 512


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
    events = [DoneEvent(summary="Resumen persistido.", chunks_used=1)]

    with patched_generation(events):
        response = llm_test_client.post("/llm/summarize", json={"text": text})

    assert response.status_code == 200
    body = response.json()
    assert body["document_id"] == str(document_id)
    assert body["summary"] == "Resumen persistido."
    assert body["config"]["model"] == "/models/fake-served.gguf"
    assert body["config"]["options"]["max_tokens"] == 4096
    assert body["config"]["system_prompt"]

    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record is not None
        assert record.text == text
        assert record.summary == "Resumen persistido."
        assert record.config["model"] == "/models/fake-served.gguf"
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
        "aymurai.api.endpoints.routers.llm.summarization.prepare_run", new=_fail
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

    events = [DoneEvent(summary="# Resumen nuevo", chunks_used=1)]

    with patched_generation(events):
        response = llm_test_client.post(
            "/llm/summarize?use_cache=false", json={"text": text}
        )

    assert response.status_code == 200
    assert response.json()["summary"] == "# Resumen nuevo"

    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record.summary == "# Resumen nuevo"
        assert record.validation is None
        assert record.config["model"] == "/models/fake-served.gguf"


def test_summarize_end_to_end_under_llamacpp_default_provider(
    llm_test_client, monkeypatch
):
    from aymurai.settings import settings

    # No override here on purpose: llamacpp is the only backend now, and only
    # LLAMACPP_BASE_URL is configured, exactly like a fresh deployment.
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    mock_openai_client, mock_raw_client = fake_llamacpp_network()

    async def _stream():
        yield SimpleNamespace(
            choices=[
                SimpleNamespace(
                    delta=SimpleNamespace(content="Resumen llamacpp."),
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
            "/llm/summarize",
            json={"text": "Texto de entrada corto a resumir (llamacpp default)."},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == "Resumen llamacpp."
    assert body["model"] == "/models/real-model.gguf"
    mock_openai_client.close.assert_awaited_once()
    # The request body omitted `options`, so the router used its defaults.
    assert body["options"] == {"max_tokens": 4096}

    mock_openai_client.chat.completions.create.assert_awaited_once()
    _, kwargs = mock_openai_client.chat.completions.create.call_args
    assert "options" not in kwargs
    assert "num_ctx" not in kwargs
    assert kwargs["max_tokens"] == 4096
    assert kwargs["messages"][0]["role"] == "system"


def test_summarize_closes_the_client_even_when_generation_raises(
    llm_test_client, monkeypatch
):
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    mock_openai_client, mock_raw_client = fake_llamacpp_network()
    mock_openai_client.chat.completions.create = AsyncMock(
        side_effect=RuntimeError("boom")
    )

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
            "/llm/summarize",
            json={"text": "Texto de entrada corto a resumir (raises)."},
        )

    assert response.status_code == 500
    mock_openai_client.close.assert_awaited_once()


def test_summarize_rejects_unknown_option_keys(llm_test_client, monkeypatch):
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    response = llm_test_client.post(
        "/llm/summarize",
        json={"text": "hola", "options": {"num_ctx": 8192}},
    )

    # `num_ctx` is Ollama vocabulary and no longer exists; extra="forbid".
    assert response.status_code == 422


def test_summarize_rejects_the_removed_tokenizer_field(llm_test_client, monkeypatch):
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    response = llm_test_client.post(
        "/llm/summarize",
        json={"text": "hola", "tokenizer": "o200k_harmony"},
    )

    assert response.status_code == 422


def test_summarize_accepts_openai_native_options(llm_test_client, monkeypatch):
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    response = llm_test_client.post(
        "/llm/summarize",
        json={"text": "hola", "options": {"max_tokens": 256, "temperature": 0.0}},
    )

    # Reaches the provider (which is unreachable in tests) rather than 422-ing
    # on the schema.
    assert response.status_code != 422


def test_summarize_fails_closed_when_llamacpp_base_url_unset(
    llm_test_client, monkeypatch
):
    from aymurai.settings import settings

    # Zero-config deployment: LLM_PROVIDER defaults to llamacpp, but nobody
    # set LLAMACPP_BASE_URL. Without the guard in LlamaCppLLMProvider this
    # would silently send the request body to https://api.openai.com.
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", None)

    response = llm_test_client.post(
        "/llm/summarize",
        json={"text": "Texto de entrada corto a resumir (sin base url)."},
    )

    assert response.status_code == 500
