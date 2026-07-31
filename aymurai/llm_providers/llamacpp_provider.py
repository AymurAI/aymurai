from __future__ import annotations

from aymurai.llm_providers.openai_compatible_provider import OpenAICompatibleLLMProvider
from aymurai.settings import settings

# `llama-server` serves whichever model it was launched with and ignores the
# `model` field, but the OpenAI SDK requires a non-empty string.
DEFAULT_LLAMACPP_MODEL = "llamacpp"


class LlamaCppLLMProvider(OpenAICompatibleLLMProvider):
    """Provider for a `llama.cpp` (`llama-server`) OpenAI-compatible endpoint."""

    provider_name: str = "llamacpp"

    def __init__(
        self,
        model: str | None = None,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        **kwargs,
    ) -> None:
        """
        Initialize a llama.cpp provider, defaulting connection details from settings.

        Args:
            model (str | None): Model identifier. Defaults to
                `DEFAULT_LLAMACPP_MODEL`, since `llama-server` ignores the field.
            base_url (str | None): Base URL override. Defaults to
                `settings.LLAMACPP_BASE_URL`.
            api_key (str | None): API key override. Defaults to
                `settings.LLAMACPP_API_KEY`.
            **kwargs: Forwarded to `OpenAICompatibleLLMProvider`
                (`system_prompt`, `tokenizer`, `max_context_tokens`,
                `chunk_overlap`).
        """
        super().__init__(
            model=model or DEFAULT_LLAMACPP_MODEL,
            base_url=base_url or settings.LLAMACPP_BASE_URL,
            api_key=api_key or settings.LLAMACPP_API_KEY,
            **kwargs,
        )


__all__ = ["DEFAULT_LLAMACPP_MODEL", "LlamaCppLLMProvider"]
