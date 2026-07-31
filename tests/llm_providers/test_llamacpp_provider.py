from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from aymurai.llm_providers import LlamaCppLLMProvider
from aymurai.llm_providers.llamacpp_provider import DEFAULT_LLAMACPP_MODEL
from aymurai.settings import settings

MODULE = "aymurai.llm_providers.openai_compatible_provider"


def _fake_completion(content: str) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2),
    )


def test_defaults_resolve_from_settings(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    monkeypatch.setattr(settings, "LLAMACPP_API_KEY", "secret")

    provider = LlamaCppLLMProvider()

    assert provider.base_url == "http://llamacpp:8080/v1"
    assert provider.api_key == "secret"
    assert provider.model_name == DEFAULT_LLAMACPP_MODEL


def test_explicit_arguments_override_settings(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    monkeypatch.setattr(settings, "LLAMACPP_API_KEY", "secret")

    provider = LlamaCppLLMProvider(
        model="qwen3",
        base_url="http://other:9090/v1",
        api_key="override",
    )

    assert provider.model_name == "qwen3"
    assert provider.base_url == "http://other:9090/v1"
    assert provider.api_key == "override"


def test_forwards_base_provider_kwargs(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider(
        system_prompt="Sistema",
        max_context_tokens=1234,
        chunk_overlap=8,
    )

    assert provider.system_prompt == "Sistema"
    assert provider.max_context_tokens == 1234
    assert provider.chunk_overlap == 8


def test_metadata_provider_is_llamacpp(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider()
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _fake_completion("ok")

    with patch(f"{MODULE}.OpenAI", return_value=mock_client):
        response = provider.generate("Hola")

    assert response.text == "ok"
    assert response.metadata["provider"] == "llamacpp"
    assert response.metadata["model"] == DEFAULT_LLAMACPP_MODEL
