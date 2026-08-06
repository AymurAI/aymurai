from __future__ import annotations

from aymurai.llm_providers.llamacpp_provider import LlamaCppLLMProvider
from aymurai.llm_providers.ollama_provider import OllamaLLMProvider
from aymurai.llm_providers.provider import LLMProvider
from aymurai.settings import settings

SUPPORTED_PROVIDERS: tuple[str, ...] = ("ollama", "llamacpp")


def get_llm_provider(model: str | None = None, **kwargs) -> LLMProvider:
    """
    Build the LLM provider selected by `settings.LLM_PROVIDER`.

    Args:
        model (str | None): Model identifier. Defaults to None, which falls back
            to `settings.OLLAMA_DEFAULT_MODEL` for Ollama and to
            `settings.LLAMACPP_DEFAULT_MODEL` for llama.cpp.
        **kwargs: Forwarded verbatim to the concrete provider (`tokenizer`,
            `system_prompt`, `max_context_tokens`, `chunk_overlap`, ...).

    Raises:
        ValueError: If `settings.LLM_PROVIDER` is not one of
            `SUPPORTED_PROVIDERS`.

    Returns:
        LLMProvider: A concrete provider instance for the configured backend.
    """
    provider_name = settings.LLM_PROVIDER

    if provider_name == "ollama":
        return OllamaLLMProvider(model=model or settings.OLLAMA_DEFAULT_MODEL, **kwargs)

    if provider_name == "llamacpp":
        return LlamaCppLLMProvider(model=model, **kwargs)

    raise ValueError(
        f"Unsupported LLM_PROVIDER: {provider_name!r}. "
        f"Supported values are: {', '.join(SUPPORTED_PROVIDERS)}."
    )


__all__ = ["SUPPORTED_PROVIDERS", "get_llm_provider"]
