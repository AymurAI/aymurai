import json
from unittest.mock import AsyncMock, patch

import pytest

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


def test_summarize_rejects_non_positive_max_tokens(llm_test_client):
    response = llm_test_client.post(
        "/llm/summarize",
        json={"text": "hola", "options": {"max_tokens": 0}},
    )
    assert response.status_code == 422


def test_summarize_returns_summary_from_single_chunk(llm_test_client, monkeypatch):
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
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


def test_summarize_uses_requested_model_and_options(llm_test_client, monkeypatch):
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
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
                "options": {"max_tokens": 512},
            },
        )

    assert response.status_code == 200
    assert response.json()["model"] == "phi4:14b"
    assert response.json()["options"]["max_tokens"] == 512
    _, kwargs = mock_generate.call_args
    assert kwargs["options"]["max_tokens"] == 512


def test_summarize_stream_emits_meta_token_and_summary_events(
    llm_test_client, monkeypatch
):
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")

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
    llm_test_client, llm_engine, monkeypatch
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
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
    assert body["config"]["options"]["max_tokens"] == 4096
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
    llm_test_client, llm_engine, monkeypatch
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
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


def test_summarize_stream_meta_event_carries_document_id(llm_test_client, monkeypatch):
    from aymurai.database.utils import text_to_uuid
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
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
    llm_test_client, llm_engine, monkeypatch
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
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


def test_summarize_stream_cache_hit_replays_stored_summary_and_preserves_validation(
    llm_test_client, llm_engine, monkeypatch
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
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

    def _fail(*args, **kwargs):
        raise AssertionError("the provider must not be called on a stream cache hit")

    with patch(
        "aymurai.llm_providers.OllamaLLMProvider.async_stream",
        new=_fail,
    ):
        response = llm_test_client.post("/llm/summarize/stream", json={"text": text})

    assert response.status_code == 200
    events = _parse_sse(response.text)
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
    llm_test_client, llm_engine, monkeypatch
):
    from sqlmodel import Session

    from aymurai.database.schema import Summarization
    from aymurai.database.utils import text_to_uuid
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
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

    async def fake_stream(self, prompt, **kwargs):
        from aymurai.llm_providers import LLMResponse as _LLMResponse

        for piece in ["# ", "Resumen nuevo"]:
            yield _LLMResponse(text=piece, metadata={})

    with patch(
        "aymurai.llm_providers.OllamaLLMProvider.async_stream",
        new=fake_stream,
    ):
        response = llm_test_client.post(
            "/llm/summarize/stream?use_cache=false", json={"text": text}
        )

    assert response.status_code == 200
    events = _parse_sse(response.text)
    assert events[-1]["type"] == "summary"
    assert events[-1]["summary"] == "# Resumen nuevo"

    with Session(llm_engine) as session:
        record = session.get(Summarization, document_id)
        assert record.summary == "# Resumen nuevo"
        assert record.validation is None
        assert record.config["model"] == "gpt-oss:20b"


@pytest.mark.anyio
async def test_build_provider_uses_the_configured_llm_provider(monkeypatch):
    from aymurai.api.endpoints.routers.llm import summarization
    from aymurai.llm_providers import LlamaCppLLMProvider, OllamaLLMProvider
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
    ollama_provider, ollama_effective_ctx = await summarization._build_provider(
        "llama3",
        tokenizer_name=None,
        system_prompt="Sistema",
        context_limit=4096,
        options={"num_predict": 0},
    )
    assert isinstance(ollama_provider, OllamaLLMProvider)
    assert ollama_provider.model_name == "llama3"
    assert ollama_provider.system_prompt == "Sistema"
    assert ollama_provider.max_context_tokens == 4096 - len("Sistema".split())
    # Ollama has no server-fixed context ceiling to discover.
    assert ollama_effective_ctx is None

    monkeypatch.setattr(settings, "LLM_PROVIDER", "llamacpp")
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    llamacpp_provider, llamacpp_effective_ctx = await summarization._build_provider(
        "llama3",
        tokenizer_name=None,
        system_prompt="Sistema",
        context_limit=4096,
        options={"num_predict": 0},
    )
    assert isinstance(llamacpp_provider, LlamaCppLLMProvider)
    assert llamacpp_provider.base_url == "http://llamacpp:8080/v1"
    assert llamacpp_provider.system_prompt == "Sistema"
    # aresolve_served_model() isn't mocked here, so it fails and falls back
    # to the requested context_limit as-is (see _build_provider).
    assert llamacpp_effective_ctx == 4096


def test_summarize_end_to_end_under_llamacpp_default_provider(
    llm_test_client, monkeypatch
):
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from aymurai.settings import settings

    # No LLM_PROVIDER override here on purpose: llamacpp is the true global
    # default (see settings.LLM_PROVIDER), and only LLAMACPP_BASE_URL is
    # configured, exactly like a fresh deployment.
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    completion = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="Resumen llamacpp."))],
        usage=SimpleNamespace(prompt_tokens=11, completion_tokens=3),
    )
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=completion)
    mock_client.close = AsyncMock()

    # The exact preflight count (LlamaCppLLMProvider.acount_prompt_tokens) hits
    # the raw httpx client, not the OpenAI SDK one — since Task 2 removed its
    # fallback-to-estimate, that must be mocked too or the request 500s.
    mock_raw_client = MagicMock()
    mock_raw_client.post = AsyncMock(
        side_effect=lambda url, **kwargs: SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: (
                {"prompt": "<rendered>"}
                if url == "/apply-template"
                else {"tokens": [0, 1]}
            ),
        )
    )
    mock_raw_client.aclose = AsyncMock()

    with (
        patch(
            "aymurai.llm_providers.openai_compatible_provider.AsyncOpenAI",
            return_value=mock_client,
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
    assert body["model"] == settings.LLAMACPP_DEFAULT_MODEL
    mock_client.close.assert_awaited_once()
    # The request body omitted `options`, so the router used its defaults.
    assert body["options"] == {"max_tokens": 4096}

    mock_client.chat.completions.create.assert_awaited_once()
    _, kwargs = mock_client.chat.completions.create.call_args
    assert "options" not in kwargs
    assert "num_ctx" not in kwargs
    assert kwargs["max_tokens"] == 4096
    assert kwargs["messages"][0]["role"] == "system"


def test_summarize_closes_the_client_even_when_generation_raises(
    llm_test_client, monkeypatch
):
    from unittest.mock import MagicMock

    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=RuntimeError("boom"))
    mock_client.close = AsyncMock()

    with patch(
        "aymurai.llm_providers.openai_compatible_provider.AsyncOpenAI",
        return_value=mock_client,
    ):
        response = llm_test_client.post(
            "/llm/summarize",
            json={"text": "Texto de entrada corto a resumir (raises)."},
        )

    assert response.status_code == 500
    mock_client.close.assert_awaited_once()


def test_summarize_stream_closes_the_client_after_the_stream_completes(
    llm_test_client, monkeypatch
):
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    async def fake_stream():
        yield SimpleNamespace(
            choices=[
                SimpleNamespace(
                    delta=SimpleNamespace(content="Resumen."),
                    finish_reason="stop",
                )
            ]
        )

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=fake_stream())
    mock_client.close = AsyncMock()

    with patch(
        "aymurai.llm_providers.openai_compatible_provider.AsyncOpenAI",
        return_value=mock_client,
    ):
        response = llm_test_client.post(
            "/llm/summarize/stream",
            json={"text": "Texto corto para stream close."},
        )

    assert response.status_code == 200
    mock_client.close.assert_awaited_once()


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
