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
    assert body["model"] == settings.OLLAMA_DEFAULT_MODEL
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
                "options": {"num_ctx": 8192, "num_predict": 512},
            },
        )

    assert response.status_code == 200
    assert response.json()["model"] == "phi4:14b"
    assert response.json()["options"]["num_ctx"] == 8192
    _, kwargs = mock_generate.call_args
    assert kwargs["options"]["num_predict"] == 512


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


def test_build_provider_uses_the_configured_llm_provider(monkeypatch):
    from aymurai.api.endpoints.routers.llm import summarization
    from aymurai.llm_providers import LlamaCppLLMProvider, OllamaLLMProvider
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
    ollama_provider = summarization._build_provider(
        "llama3",
        tokenizer_name=None,
        system_prompt="Sistema",
        context_limit=4096,
    )
    assert isinstance(ollama_provider, OllamaLLMProvider)
    assert ollama_provider.model_name == "llama3"
    assert ollama_provider.system_prompt == "Sistema"
    assert ollama_provider.max_context_tokens == 4096 - len("Sistema".split())

    monkeypatch.setattr(settings, "LLM_PROVIDER", "llamacpp")
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    llamacpp_provider = summarization._build_provider(
        "llama3",
        tokenizer_name=None,
        system_prompt="Sistema",
        context_limit=4096,
    )
    assert isinstance(llamacpp_provider, LlamaCppLLMProvider)
    assert llamacpp_provider.base_url == "http://llamacpp:8080/v1"
    assert llamacpp_provider.system_prompt == "Sistema"


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

    with patch(
        "aymurai.llm_providers.openai_compatible_provider.AsyncOpenAI",
        return_value=mock_client,
    ):
        response = llm_test_client.post(
            "/llm/summarize",
            json={"text": "Texto de entrada corto a resumir."},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == "Resumen llamacpp."
    assert body["model"] == settings.LLAMACPP_DEFAULT_MODEL
    mock_client.close.assert_awaited_once()
    # The request body omitted `options`, so the router used its defaults.
    assert body["options"] == {"num_ctx": 16_384, "num_predict": 4096}

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
            json={"text": "Texto de entrada corto a resumir."},
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
            json={"text": "Texto corto."},
        )

    assert response.status_code == 200
    mock_client.close.assert_awaited_once()


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
        json={"text": "Texto de entrada corto a resumir."},
    )

    assert response.status_code == 500
