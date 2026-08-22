from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any

from openai import AsyncOpenAI, OpenAI
from pydantic import BaseModel, Field

from aymurai.logger import get_logger

logger = get_logger(__name__)


class LLMResponse(BaseModel):
    """Standard response wrapper returned by every provider call."""

    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw: Any | None = None


class OpenAICompatibleLLMProvider:
    """Adapter for any server that speaks the OpenAI chat-completions protocol."""

    provider_name: str = "openai-compatible"

    def __init__(
        self,
        model: str,
        *,
        base_url: str | None = None,
        api_key: str = "not-needed",
        system_prompt: str | None = None,
    ) -> None:
        """
        Initialize an OpenAI-compatible provider.

        Args:
            model (str): Model identifier forwarded to the server.
            base_url (str | None): Base URL of the OpenAI-compatible server
                (e.g. `http://llamacpp:8080/v1`). Defaults to None, which lets
                the SDK use its own default endpoint.
            api_key (str): API key sent to the server. Local servers typically
                ignore it, but the SDK requires a non-empty value. Defaults to
                "not-needed".
            system_prompt (str | None): Optional system prompt prepended when a
                bare `prompt` is supplied. Defaults to None.
        """
        self.model_name = model
        self.base_url = base_url
        self.api_key = api_key
        self.system_prompt = system_prompt
        self._client: OpenAI | None = None
        self._async_client: AsyncOpenAI | None = None

    def close(self) -> None:
        """
        Close the cached synchronous client, if one was created.

        Safe to call even if `_get_client` was never invoked, and safe to
        call more than once. A later call still lazily recreates a fresh
        client rather than raising, since `close()` only clears the cache.
        """
        if self._client is not None:
            self._client.close()
            self._client = None

    async def aclose(self) -> None:
        """
        Close the cached asynchronous client, if one was created.

        Safe to call even if `_get_async_client` was never invoked, and safe
        to call more than once. Callers that build a provider per request
        (e.g. `/llm/summarize`) should call this once the request completes,
        in a `finally` block, so the underlying `httpx` connection pool is
        released deterministically instead of relying on garbage collection.
        """
        if self._async_client is not None:
            await self._async_client.close()
            self._async_client = None

    def generate(
        self,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        **kwargs,
    ) -> LLMResponse:
        """
        Generate text using the configured OpenAI-compatible server.

        Args:
            prompt (str | None): Optional single prompt string to be transformed
                into a chat message. Defaults to None.
            messages (list[dict[str, str]] | None): Optional list of
                pre-formatted chat messages to send. Defaults to None.
            **kwargs: Additional OpenAI-native chat-completion parameters
                (e.g. `max_tokens`, `temperature`), forwarded as-is.

        Raises:
            ValueError: If neither `prompt` nor `messages` is provided.

        Returns:
            LLMResponse: Response containing the generated text, metadata about
                the request, and the raw SDK payload.
        """
        payload = self._build_messages(prompt=prompt, messages=messages)
        request_kwargs = self._build_request_kwargs(kwargs)

        client = self._get_client()
        completion = client.chat.completions.create(
            model=self.model_name,
            messages=payload,
            **request_kwargs,
        )

        return self._build_llm_response(completion)

    async def async_generate(
        self,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        **kwargs,
    ) -> LLMResponse:
        """
        Asynchronously generate text using the configured server.

        Args:
            prompt (str | None): Optional single prompt string to be transformed
                into a chat message. Defaults to None.
            messages (list[dict[str, str]] | None): Optional list of
                pre-formatted chat messages to send. Defaults to None.
            **kwargs: Additional OpenAI-native chat-completion parameters
                (e.g. `max_tokens`, `temperature`), forwarded as-is.

        Raises:
            ValueError: If neither `prompt` nor `messages` is provided.

        Returns:
            LLMResponse: Response containing the generated text, metadata about
                the request, and the raw SDK payload.
        """
        payload = self._build_messages(prompt=prompt, messages=messages)
        request_kwargs = self._build_request_kwargs(kwargs)

        client = self._get_async_client()
        completion = await client.chat.completions.create(
            model=self.model_name,
            messages=payload,
            **request_kwargs,
        )

        return self._build_llm_response(completion)

    def stream(
        self,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        **kwargs,
    ) -> Iterator[LLMResponse]:
        """
        Stream the response from the server using the provided prompt or messages.

        Args:
            prompt (str | None): Optional single prompt string to be transformed
                into a chat message. Defaults to None.
            messages (list[dict[str, str]] | None): Optional list of
                pre-formatted chat messages to send. Defaults to None.
            **kwargs: Additional OpenAI-native chat-completion parameters
                (e.g. `max_tokens`, `temperature`), forwarded as-is.

        Raises:
            ValueError: If neither `prompt` nor `messages` is provided.

        Yields:
            Iterator[LLMResponse]: Response chunks containing generated text,
                metadata, and raw payloads.
        """
        payload = self._build_messages(prompt=prompt, messages=messages)
        request_kwargs = {**self._build_request_kwargs(kwargs), "stream": True}

        client = self._get_client()
        for chunk in client.chat.completions.create(
            model=self.model_name,
            messages=payload,
            **request_kwargs,
        ):
            yield self._build_stream_response(chunk)

    async def async_stream(
        self,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        system_prompt: str | None = None,
        **kwargs,
    ) -> AsyncIterator[LLMResponse]:
        """
        Asynchronously stream the response from the server.

        Args:
            prompt (str | None): Optional single prompt string to be transformed
                into a chat message. Defaults to None.
            messages (list[dict[str, str]] | None): Optional list of
                pre-formatted chat messages to send. Defaults to None.
            system_prompt (str | None): Per-call override of `self.system_prompt`,
                used when building a chat message from `prompt`. Lets a single
                provider instance switch prompts across calls (e.g. rolling
                summarization's first-pass vs. follow-up system prompt).
            **kwargs: Additional OpenAI-native chat-completion parameters
                (e.g. `max_tokens`, `temperature`), forwarded as-is.

        Raises:
            ValueError: If neither `prompt` nor `messages` is provided.

        Yields:
            AsyncIterator[LLMResponse]: Asynchronous iterator yielding response
                chunks containing generated text, metadata, and raw payloads.
        """
        payload = self._build_messages(
            prompt=prompt, messages=messages, system_prompt=system_prompt
        )
        request_kwargs = {**self._build_request_kwargs(kwargs), "stream": True}

        client = self._get_async_client()
        stream = await client.chat.completions.create(
            model=self.model_name,
            messages=payload,
            **request_kwargs,
        )
        async for chunk in stream:
            yield self._build_stream_response(chunk)

    def _build_messages(
        self,
        *,
        prompt: str | None,
        messages: list[dict[str, str]] | None = None,
        system_prompt: str | None = None,
    ) -> list[dict[str, str]]:
        """
        Build the message payload for the chat-completions call.

        Args:
            prompt (str | None): The user prompt to be sent to the model.
            messages (list[dict[str, str]] | None): A list of message
                dictionaries to be sent to the model. Defaults to None.
            system_prompt (str | None): Per-call override of
                `self.system_prompt`. Ignored when `messages` is given —
                callers building their own messages control the system turn
                directly.

        Raises:
            ValueError: If neither prompt nor messages are provided.

        Returns:
            list[dict[str, str]]: The message payload to be sent to the server.
        """
        if messages is not None:
            return list(messages)

        if prompt is None:
            raise ValueError("Either prompt or messages must be provided.")

        payload = []

        active_system_prompt = (
            system_prompt if system_prompt is not None else self.system_prompt
        )
        if active_system_prompt:
            payload.append({"role": "system", "content": active_system_prompt})

        payload.append({"role": "user", "content": prompt})

        return payload

    def _get_client(self) -> OpenAI:
        """
        Return the cached synchronous OpenAI SDK client, creating it on first use.

        `httpx.Client` (which `OpenAI` wraps) is safe to reuse across
        multiple, even concurrent, calls — so one client per provider
        instance replaces the previous one-client-per-call behavior. Call
        `close()` to release its connection pool once the provider is done.

        Returns:
            OpenAI: The cached client pointed at the configured base URL.
        """
        if self._client is None:
            self._client = OpenAI(base_url=self.base_url, api_key=self.api_key)
        return self._client

    def _get_async_client(self) -> AsyncOpenAI:
        """
        Return the cached asynchronous OpenAI SDK client, creating it on first use.

        `httpx.AsyncClient` (which `AsyncOpenAI` wraps) is safe to reuse
        across multiple, even concurrent, calls within the same event loop —
        so one client per provider instance replaces the previous
        one-client-per-call behavior. Call `aclose()` to release its
        connection pool once the provider is done.

        Returns:
            AsyncOpenAI: The cached client pointed at the configured base URL.
        """
        if self._async_client is None:
            self._async_client = AsyncOpenAI(
                base_url=self.base_url, api_key=self.api_key
            )
        return self._async_client

    def _build_request_kwargs(  # ast-grep-ignore: no-dict-return-annotation
        self, kwargs: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Normalize caller kwargs for the chat-completions call.

        Parameters are already OpenAI-native, so this only defends against the
        one collision that would otherwise raise deep in the SDK.

        Args:
            kwargs (dict[str, Any]): Raw keyword arguments from the caller.

        Raises:
            ValueError: If `model` is passed, which would collide with the
                explicit `model=self.model_name` argument.

        Returns:
            dict[str, Any]: Keyword arguments safe to forward.
        """
        if "model" in kwargs:
            raise ValueError(
                "pass the model to the constructor, not to generate()/stream()"
            )
        return dict(kwargs)

    def _build_llm_response(self, completion: Any) -> LLMResponse:
        """
        Build an LLMResponse with consistent metadata from a completion object.

        Args:
            completion (Any): The chat-completion object returned by the SDK.

        Returns:
            LLMResponse: The constructed LLMResponse containing text, metadata,
                and the raw SDK object.
        """
        choices = getattr(completion, "choices", None) or []

        text = ""
        if choices:
            message = getattr(choices[0], "message", None)
            text = getattr(message, "content", "") or ""

        usage = getattr(completion, "usage", None)

        metadata = {
            "model": self.model_name,
            "provider": self.provider_name,
            "prompt_tokens": getattr(usage, "prompt_tokens", None),
            "completion_tokens": getattr(usage, "completion_tokens", None),
        }

        return LLMResponse(text=text, metadata=metadata, raw=completion)

    def _build_stream_response(self, chunk: Any) -> LLMResponse:
        """
        Build a stream response with consistent metadata from a chunk object.

        Args:
            chunk (Any): A streamed chat-completion chunk returned by the SDK.

        Returns:
            LLMResponse: The constructed LLMResponse containing the delta text,
                metadata (including the `done` flag), and the raw chunk.
        """
        choices = getattr(chunk, "choices", None) or []

        text = ""
        finish_reason = None
        if choices:
            delta = getattr(choices[0], "delta", None)
            text = getattr(delta, "content", "") or ""
            finish_reason = getattr(choices[0], "finish_reason", None)

        metadata = {
            "model": self.model_name,
            "provider": self.provider_name,
            "done": finish_reason is not None,
            "finish_reason": finish_reason,
        }

        return LLMResponse(text=text, metadata=metadata, raw=chunk)


__all__ = ["LLMResponse", "OpenAICompatibleLLMProvider"]
