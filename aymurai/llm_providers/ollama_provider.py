from __future__ import annotations

from typing import Any

from aymurai.llm_providers.openai_compatible_provider import OpenAICompatibleLLMProvider
from aymurai.settings import settings


class OllamaLLMProvider(OpenAICompatibleLLMProvider):
    """Provider for Ollama's own OpenAI-compatible `/v1` chat endpoint."""

    provider_name: str = "ollama"

    def __init__(
        self,
        model: str,
        *,
        host: str | None = None,
        api_key: str = "not-needed",
        keep_alive: int | str | None = None,
        **kwargs,
    ) -> None:
        """
        Initialize an Ollama provider against its OpenAI-compatible `/v1` endpoint.

        Args:
            model (str): Model identifier forwarded to Ollama.
            host (str | None): Ollama server host (e.g. `http://ollama:11434`).
                Defaults to `settings.OLLAMA_HOST`. The `/v1` suffix required
                by Ollama's OpenAI-compatible endpoint is appended
                automatically.
            api_key (str): API key sent to the server. Ollama ignores it, but
                the SDK requires a non-empty value. Defaults to "not-needed".
            keep_alive (int | str | None): Optional model-residency TTL (e.g.
                `"1h"` or a number of seconds), forwarded via `extra_body`
                since the OpenAI chat-completions schema has no first-class
                field for it. Defaults to None (server default).
            **kwargs: Forwarded to `OpenAICompatibleLLMProvider`
                (`system_prompt`, `tokenizer`, `max_context_tokens`,
                `chunk_overlap`).
        """
        base_url = f"{(host or settings.OLLAMA_HOST).rstrip('/')}/v1"
        super().__init__(model=model, base_url=base_url, api_key=api_key, **kwargs)
        self.keep_alive = keep_alive

    def _build_request_kwargs(  # ast-grep-ignore: no-dict-return-annotation
        self, kwargs: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Extend the shared translation with Ollama's `keep_alive` residency TTL.

        `keep_alive` has no first-class field in the OpenAI chat-completions
        schema, so it rides in `extra_body` — the SDK-supported escape hatch
        for server-specific extensions. An explicit `extra_body["keep_alive"]`
        from the caller always wins over the constructor default.

        Args:
            kwargs (dict[str, Any]): Raw keyword arguments from the caller.

        Returns:
            dict[str, Any]: Keyword arguments safe to forward to the SDK.
        """
        request_kwargs = super()._build_request_kwargs(kwargs)

        if self.keep_alive is not None:
            extra_body = {
                "keep_alive": self.keep_alive,
                **(request_kwargs.get("extra_body") or {}),
            }
            request_kwargs["extra_body"] = extra_body

        return request_kwargs


__all__ = ["OllamaLLMProvider"]
