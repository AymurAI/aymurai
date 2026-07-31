import pytest

from aymurai.llm_providers import (
    LlamaCppLLMProvider,
    OllamaLLMProvider,
    get_llm_provider,
)
from aymurai.llm_providers.factory import DEFAULT_OLLAMA_MODEL, SUPPORTED_PROVIDERS
from aymurai.settings import settings


def test_returns_ollama_provider_by_default(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")

    provider = get_llm_provider(model="llama3")

    assert isinstance(provider, OllamaLLMProvider)
    assert provider.model_name == "llama3"


def test_ollama_provider_falls_back_to_default_model(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")

    provider = get_llm_provider()

    assert isinstance(provider, OllamaLLMProvider)
    assert provider.model_name == DEFAULT_OLLAMA_MODEL


def test_returns_llamacpp_provider_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "llamacpp")
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = get_llm_provider()

    assert isinstance(provider, LlamaCppLLMProvider)
    assert provider.base_url == "http://llamacpp:8080/v1"


def test_forwards_kwargs_to_ollama_provider(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")

    provider = get_llm_provider(
        model="llama3",
        system_prompt="Sistema",
        max_context_tokens=4096,
    )

    assert provider.system_prompt == "Sistema"
    assert provider.max_context_tokens == 4096


def test_forwards_kwargs_to_llamacpp_provider(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "llamacpp")
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = get_llm_provider(
        model="qwen3",
        system_prompt="Sistema",
        max_context_tokens=4096,
    )

    assert provider.model_name == "qwen3"
    assert provider.system_prompt == "Sistema"
    assert provider.max_context_tokens == 4096


def test_raises_value_error_for_unknown_provider(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "vllm")

    with pytest.raises(ValueError) as excinfo:
        get_llm_provider(model="whatever")

    message = str(excinfo.value)
    assert "vllm" in message
    for supported in SUPPORTED_PROVIDERS:
        assert supported in message
