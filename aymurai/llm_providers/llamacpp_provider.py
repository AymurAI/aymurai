from __future__ import annotations

from aymurai.llm_providers.openai_compatible_provider import OpenAICompatibleLLMProvider
from aymurai.settings import settings


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
                `settings.LLAMACPP_DEFAULT_MODEL`, since `llama-server` ignores
                the field.
            base_url (str | None): Base URL override. Defaults to
                `settings.LLAMACPP_BASE_URL`.
            api_key (str | None): API key override. Defaults to
                `settings.LLAMACPP_API_KEY`.
            **kwargs: Forwarded to `OpenAICompatibleLLMProvider`
                (`system_prompt`, `tokenizer`, `max_context_tokens`,
                `chunk_overlap`).

        Raises:
            ValueError: If neither `base_url` nor `settings.LLAMACPP_BASE_URL`
                is set. Without this guard the OpenAI SDK silently falls back
                to the public `https://api.openai.com` endpoint, sending
                request bodies to a third party instead of failing loudly.
        """
        resolved_base_url = base_url or settings.LLAMACPP_BASE_URL
        if not resolved_base_url:
            raise ValueError(
                "LlamaCppLLMProvider requires a base URL. Set LLAMACPP_BASE_URL "
                "(e.g. http://llama-server:8080/v1) or pass base_url= explicitly."
            )

        super().__init__(
            model=model or settings.LLAMACPP_DEFAULT_MODEL,
            base_url=resolved_base_url,
            api_key=api_key or settings.LLAMACPP_API_KEY,
            **kwargs,
        )


__all__ = ["LlamaCppLLMProvider"]
