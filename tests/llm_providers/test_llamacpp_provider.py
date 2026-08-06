from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from aymurai.llm_providers import LlamaCppLLMProvider
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
    assert provider.model_name == settings.LLAMACPP_DEFAULT_MODEL


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
    assert response.metadata["model"] == settings.LLAMACPP_DEFAULT_MODEL


def test_raises_without_base_url_configured(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", None)

    with pytest.raises(ValueError, match="LLAMACPP_BASE_URL"):
        LlamaCppLLMProvider()


def test_explicit_base_url_satisfies_the_guard_even_without_settings(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", None)

    provider = LlamaCppLLMProvider(base_url="http://other:9090/v1")

    assert provider.base_url == "http://other:9090/v1"
