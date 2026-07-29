from __future__ import annotations

from typing import Any, AsyncIterator, Iterator

import ollama
from ollama import AsyncClient

from aymurai.llm_providers.provider import LLMProvider, LLMResponse


class OllamaLLMProvider(LLMProvider):
    """Adapter that wraps `ollama.chat` preserving the common interface."""

    def __init__(
        self,
        model: str,
        *,
        system_prompt: str | None = None,
        keep_alive: int | str | None = None,
        **kwargs,
    ) -> None:
        super().__init__(model=model, **kwargs)
        self.system_prompt = system_prompt
        self.keep_alive = keep_alive

    def generate(
        self,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        **kwargs,
    ) -> LLMResponse:
        payload = self._build_messages(prompt=prompt, messages=messages)

        response = ollama.chat(
            model=self.model_name,
            messages=payload,
            keep_alive=self.keep_alive,
            **kwargs,
        )

        return self._build_llm_response(
            response,
            extra_metadata={
                "eval_count": response.get("eval_count"),
                "eval_duration": response.get("eval_duration"),
            },
        )

    async def async_generate(
        self,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        **kwargs,
    ) -> LLMResponse:
        payload = self._build_messages(prompt=prompt, messages=messages)

        client = self._get_async_client()
        response = await client.chat(
            model=self.model_name,
            messages=payload,
            keep_alive=self.keep_alive,
            **kwargs,
        )

        return self._build_llm_response(
            response,
            extra_metadata={
                "eval_count": response.get("eval_count"),
                "eval_duration": response.get("eval_duration"),
            },
        )

    def stream(
        self,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        **kwargs,
    ) -> Iterator[LLMResponse]:
        payload = self._build_messages(prompt=prompt, messages=messages)
        stream_kwargs = {**kwargs, "stream": True}

        for chunk in ollama.chat(
            model=self.model_name,
            messages=payload,
            keep_alive=self.keep_alive,
            **stream_kwargs,
        ):
            yield self._build_stream_response(chunk)

    async def async_stream(
        self,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        **kwargs,
    ) -> AsyncIterator[LLMResponse]:
        payload = self._build_messages(prompt=prompt, messages=messages)
        stream_kwargs = {**kwargs, "stream": True}

        client = self._get_async_client()
        stream = await client.chat(
            model=self.model_name,
            messages=payload,
            keep_alive=self.keep_alive,
            **stream_kwargs,
        )
        async for chunk in stream:
            yield self._build_stream_response(chunk)

    def _build_messages(
        self,
        *,
        prompt: str | None,
        messages: list[dict[str, str]] | None = None,
    ) -> list[dict[str, str]]:
        if messages is not None:
            return list(messages)

        if prompt is None:
            raise ValueError("Either prompt or messages must be provided.")

        payload = []

        if self.system_prompt:
            payload.append({"role": "system", "content": self.system_prompt})

        payload.append({"role": "user", "content": prompt})

        return payload

    def _get_async_client(self) -> AsyncClient:
        return AsyncClient()

    def _build_llm_response(
        self, response: dict[str, Any], *, extra_metadata: dict[str, Any] | None = None
    ) -> LLMResponse:
        text = response.get("message", {}).get("content", "")

        metadata = {
            "model": self.model_name,
            "provider": "ollama",
        }

        if extra_metadata:
            metadata.update(extra_metadata)

        return LLMResponse(text=text, metadata=metadata, raw=response)

    def _build_stream_response(self, chunk: dict[str, Any]) -> LLMResponse:
        return self._build_llm_response(
            chunk,
            extra_metadata={"done": chunk.get("done")},
        )


__all__ = ["OllamaLLMProvider"]
