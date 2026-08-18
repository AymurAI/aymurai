from __future__ import annotations

from typing import Any, AsyncIterator, Iterator

from openai import AsyncOpenAI, OpenAI

from aymurai.llm_providers.provider import LLMProvider, LLMResponse
from aymurai.logger import get_logger

logger = get_logger(__name__)

# Ollama's native `options` dict -> OpenAI chat-completion parameters.
# The OpenAI SDK's `create()` has no `**kwargs`, so anything not in this table
# must be dropped rather than forwarded: forwarding an unknown key raises the
# exact `TypeError` this translation exists to prevent.
_OLLAMA_OPTION_TO_OPENAI_PARAM: dict[str, str] = {
    "num_predict": "max_tokens",
    # Identity entry: `GenerationOptions` (summarization.py) is already
    # OpenAI-native and dumps `max_tokens` directly. Without this, that key
    # is absent from `_OLLAMA_OPTION_TO_OPENAI_PARAM` and gets silently
    # dropped as "unrecognized", losing the caller's output-token budget.
    "max_tokens": "max_tokens",
    "temperature": "temperature",
    "top_p": "top_p",
    "stop": "stop",
    "seed": "seed",
}

# `num_ctx` has no per-request OpenAI equivalent: in llama.cpp the context
# window is fixed when the server is launched (`-c`). Dropping it does NOT
# affect chunking — chunking reads `max_context_tokens`, which the caller sets
# on the constructor (e.g. summarization's `_build_provider`) and which this
# translation never touches. Do not "restore" `num_ctx` as a request param.
_DROPPED_OLLAMA_OPTIONS: frozenset[str] = frozenset({"num_ctx"})


class OpenAICompatibleLLMProvider(LLMProvider):
    """Adapter for any server that speaks the OpenAI chat-completions protocol."""

    provider_name: str = "openai-compatible"

    def __init__(
        self,
        model: str,
        *,
        base_url: str | None = None,
        api_key: str = "not-needed",
        system_prompt: str | None = None,
        **kwargs,
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
            **kwargs: Forwarded to `LLMProvider` (`tokenizer`,
                `max_context_tokens`, `chunk_overlap`).
        """
        super().__init__(model=model, **kwargs)
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
            **kwargs: Additional chat-completion parameters. A `format` kwarg
                (Ollama-style JSON schema dict or the literal `"json"`) is
                translated into `response_format`; an Ollama-style `options`
                dict is translated into OpenAI generation parameters.

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
            **kwargs: Additional chat-completion parameters. A `format` kwarg
                (Ollama-style JSON schema dict or the literal `"json"`) is
                translated into `response_format`; an Ollama-style `options`
                dict is translated into OpenAI generation parameters.

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
            **kwargs: Additional chat-completion parameters. A `format` kwarg
                (Ollama-style JSON schema dict or the literal `"json"`) is
                translated into `response_format`; an Ollama-style `options`
                dict is translated into OpenAI generation parameters.

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
        **kwargs,
    ) -> AsyncIterator[LLMResponse]:
        """
        Asynchronously stream the response from the server.

        Args:
            prompt (str | None): Optional single prompt string to be transformed
                into a chat message. Defaults to None.
            messages (list[dict[str, str]] | None): Optional list of
                pre-formatted chat messages to send. Defaults to None.
            **kwargs: Additional chat-completion parameters. A `format` kwarg
                (Ollama-style JSON schema dict or the literal `"json"`) is
                translated into `response_format`; an Ollama-style `options`
                dict is translated into OpenAI generation parameters.

        Raises:
            ValueError: If neither `prompt` nor `messages` is provided.

        Yields:
            AsyncIterator[LLMResponse]: Asynchronous iterator yielding response
                chunks containing generated text, metadata, and raw payloads.
        """
        payload = self._build_messages(prompt=prompt, messages=messages)
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
    ) -> list[dict[str, str]]:
        """
        Build the message payload for the chat-completions call.

        Args:
            prompt (str | None): The user prompt to be sent to the model.
            messages (list[dict[str, str]] | None): A list of message
                dictionaries to be sent to the model. Defaults to None.

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

        if self.system_prompt:
            payload.append({"role": "system", "content": self.system_prompt})

        payload.append({"role": "user", "content": prompt})

        return payload

    def count_prompt_tokens(
        self,
        *,
        prompt: str | None = None,
        messages: list[dict[str, str]] | None = None,
    ) -> int:
        """
        Estimate the prompt token count, including the system prompt.

        Still an estimate (`count_tokens` under the hood, no chat-template
        accounting) — but better than the base default, which can't see
        `system_prompt` at all. `LlamaCppLLMProvider` overrides this further
        with an exact, template-aware count.

        Args:
            prompt (str | None): Single prompt string, mutually exclusive with
                `messages`.
            messages (list[dict[str, str]] | None): Pre-formatted chat
                messages.

        Returns:
            int: The estimated prompt token count.
        """
        built = self._build_messages(prompt=prompt, messages=messages)
        return self.count_tokens(
            self._flatten_for_counting(messages=built, prompt=None)
        )

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
        Normalize caller kwargs into OpenAI chat-completion parameters.

        Pops the Ollama-style `options` and `format` kwargs and translates both.
        Translated `options` are merged in with `setdefault`, so an explicit
        top-level kwarg (e.g. `max_tokens=128`) always wins. Likewise an
        explicit `response_format` always wins and is forwarded untouched.

        Args:
            kwargs (dict[str, Any]): Raw keyword arguments from the caller.

        Returns:
            dict[str, Any]: Keyword arguments safe to forward to the SDK.
        """
        request_kwargs = dict(kwargs)
        options = request_kwargs.pop("options", None)
        format_value = request_kwargs.pop("format", None)

        for param, value in self._translate_options(options).items():
            request_kwargs.setdefault(param, value)

        if "response_format" not in request_kwargs:
            response_format = self._translate_format(format_value)
            if response_format is not None:
                request_kwargs["response_format"] = response_format

        return request_kwargs

    @staticmethod
    def _translate_options(  # ast-grep-ignore: no-dict-return-annotation
        options: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """
        Translate an Ollama-style `options` dict into OpenAI generation params.

        Maps `num_predict` to `max_tokens` and passes `temperature`, `top_p`,
        `stop` and `seed` through unchanged. `num_ctx` is dropped (it has no
        per-request OpenAI equivalent — llama.cpp fixes the context window at
        server launch with `-c`), as is any key absent from
        `_OLLAMA_OPTION_TO_OPENAI_PARAM`; both cases are logged at debug level.
        Dropping `num_ctx` does not affect chunking, which reads
        `max_context_tokens` from the constructor instead.

        Args:
            options (dict[str, Any] | None): Ollama-style generation options, or
                None when the caller passed none.

        Returns:
            dict[str, Any]: OpenAI chat-completion parameters. Empty when
                `options` is None or empty.
        """
        if not options:
            return {}  # ast-grep-ignore: no-dict-literal-return

        translated: dict[str, Any] = {}

        for key, value in options.items():
            if key in _DROPPED_OLLAMA_OPTIONS:
                logger.debug(
                    f"dropping option {key!r}: no per-request OpenAI equivalent"
                )
                continue

            openai_param = _OLLAMA_OPTION_TO_OPENAI_PARAM.get(key)
            if openai_param is None:
                logger.debug(f"dropping unrecognized option {key!r}")
                continue

            translated[openai_param] = value

        return translated

    @staticmethod
    def _translate_format(format_value: Any) -> dict[str, Any] | None:
        """
        Translate an Ollama-style `format` value into an OpenAI `response_format`.

        Args:
            format_value (Any): A JSON schema dict (as produced by pydantic's
                `model_json_schema()`), the literal string `"json"`, or None.

        Returns:
            dict[str, Any] | None: The equivalent `response_format` payload, or
                None when no structured output was requested.
        """
        if format_value is None:
            return None

        if isinstance(format_value, str):
            if format_value == "json":
                return {
                    "type": "json_object"
                }  # ast-grep-ignore: no-dict-literal-return
            return None

        if isinstance(format_value, dict):
            return {  # ast-grep-ignore: no-dict-literal-return
                "type": "json_schema",
                "json_schema": {
                    "name": format_value.get("title", "response"),
                    "schema": format_value,
                },
            }

        return None

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


__all__ = ["OpenAICompatibleLLMProvider"]
