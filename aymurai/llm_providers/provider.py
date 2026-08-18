from __future__ import annotations

import abc
from typing import Any, AsyncIterator, Sequence

from pydantic import BaseModel, Field


class LLMResponse(BaseModel):
    """Standard response wrapper for any LLM provider."""

    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw: Any | None = None


class DocumentChunk(BaseModel):
    """Represents a chunked portion of a larger document."""

    text: str
    token_count: int
    index: int


TokenizerType = Any


class LLMProvider(abc.ABC):
    """Base class with shared utilities for concrete LLM providers."""

    def __init__(
        self,
        model: str,
        *,
        tokenizer: TokenizerType | None = None,
        max_context_tokens: int | None = None,
        chunk_overlap: int = 0,
    ) -> None:
        self.model_name = model
        self._tokenizer = tokenizer
        self.max_context_tokens = max_context_tokens
        self.chunk_overlap = max(chunk_overlap, 0)

    @abc.abstractmethod
    def generate(self, prompt: str, **kwargs) -> LLMResponse:
        """
        Generate a response from the model using the provided prompt.

        Args:
            prompt (str): The input prompt to generate a response for.
            **kwargs: Additional provider-specific parameters.

        Returns:
            LLMResponse: The generated response wrapped in an LLMResponse object.
        """
        pass

    @abc.abstractmethod
    def stream(self, prompt: str, **kwargs):
        """
        Stream the response from the model using the provided prompt.

        Args:
            prompt (str): The input prompt to generate a response for.
            **kwargs: Additional provider-specific parameters.

        Raises:
            NotImplementedError: If the provider does not support streaming.
        """
        raise NotImplementedError("This provider does not support streaming.")

    @abc.abstractmethod
    async def async_generate(self, prompt: str, **kwargs) -> LLMResponse:
        """
        Asynchronously generate a response from the model using the provided prompt.

        Args:
            prompt (str): The input prompt to generate a response for.
            **kwargs: Additional provider-specific parameters.

        Raises:
            NotImplementedError: If the provider does not support async generation.

        Returns:
            LLMResponse: The generated response wrapped in an LLMResponse object.
        """
        raise NotImplementedError("This provider does not support async generation.")

    @abc.abstractmethod
    async def async_stream(self, prompt: str, **kwargs) -> AsyncIterator[LLMResponse]:
        """
        Asynchronously stream the response from the model using the provided prompt.

        Args:
            prompt (str): The input prompt to generate a response for.
            **kwargs: Additional provider-specific parameters.

        Raises:
            NotImplementedError: If the provider does not support async streaming.

        Yields:
            AsyncIterator[LLMResponse]: Response chunks, never reached by the
                default implementation.
        """
        raise NotImplementedError("This provider does not support async streaming.")
        yield  # pragma: no cover -- unreachable; makes this an async generator

    def close(self) -> None:
        """
        Release any resources held by this provider (e.g. HTTP clients).

        Default no-op; providers that hold closeable resources override this.
        """
        return None

    async def aclose(self) -> None:
        """
        Asynchronously release any resources held by this provider.

        Default no-op; providers that hold closeable resources override this.
        """
        return None

    def count_tokens(self, text: str) -> int:
        """
        Count the number of tokens in raw text, using a fast, local estimate.

        This is a chunk-sizing primitive: `chunk_text` below calls it once per
        candidate word while growing a chunk, so it must stay cheap and
        side-effect-free (no network I/O) regardless of provider. It does not
        account for chat-template formatting — for an exact, request-shaped
        prompt count, see `count_prompt_tokens`/`acount_prompt_tokens`.

        Args:
            text (str): The input text to count tokens for.

        Returns:
            int: The estimated number of tokens in the input text.
        """
        tokens = self._tokenize(text)
        return len(tokens)

    def count_prompt_tokens(
        self,
        *,
        prompt: str | None = None,
        messages: list[dict[str, str]] | None = None,
    ) -> int:
        """
        Count tokens for a chat request, as close to the real one as this
        provider can manage without a network round-trip.

        Default implementation just flattens `prompt`/`messages` into text and
        estimates via `count_tokens` — no chat-template accounting. Providers
        able to compute an exact, template-aware count (e.g.
        `LlamaCppLLMProvider`, which renders the real server-side template and
        tokenizes the result) should override this.

        Args:
            prompt (str | None): Single prompt string, mutually exclusive with
                `messages`.
            messages (list[dict[str, str]] | None): Pre-formatted chat
                messages.

        Returns:
            int: The estimated (or, where overridden, exact) prompt token
                count.
        """
        return self.count_tokens(
            self._flatten_for_counting(prompt=prompt, messages=messages)
        )

    async def acount_prompt_tokens(
        self,
        *,
        prompt: str | None = None,
        messages: list[dict[str, str]] | None = None,
    ) -> int:
        """
        Async counterpart of `count_prompt_tokens`.

        Default implementation just delegates to the sync version, since the
        default estimate needs no I/O. Providers whose exact count requires a
        network call (e.g. `LlamaCppLLMProvider`) override this directly
        rather than wrapping the sync path in a thread.

        Args:
            prompt (str | None): Single prompt string, mutually exclusive with
                `messages`.
            messages (list[dict[str, str]] | None): Pre-formatted chat
                messages.

        Returns:
            int: The estimated (or, where overridden, exact) prompt token
                count.
        """
        return self.count_prompt_tokens(prompt=prompt, messages=messages)

    @staticmethod
    def _flatten_for_counting(
        *,
        prompt: str | None,
        messages: list[dict[str, str]] | None,
    ) -> str:
        """
        Flatten a prompt or message list into a single string for estimation.

        Args:
            prompt (str | None): Single prompt string.
            messages (list[dict[str, str]] | None): Pre-formatted chat
                messages.

        Returns:
            str: Message contents joined by newlines, or the bare prompt.
        """
        if messages is not None:
            return "\n".join(message.get("content", "") for message in messages)
        return prompt or ""

    def chunk_text(
        self,
        text: str,
        *,
        max_tokens: int | None = None,
        overlap: int | None = None,
    ) -> list[DocumentChunk]:
        """
        Chunk text ensuring every piece respects the token budget.

        Sizing decisions use `count_tokens` (a fast, local estimate) — this
        can call it once per word while growing a chunk, so it must never
        become network-bound. `max_tokens` should already include headroom
        for anything `count_tokens` can't see (chat-template overhead,
        reserved output tokens, tokenizer estimation error) — callers
        wanting an exact guarantee on the final rendered prompt should
        additionally verify via `count_prompt_tokens`/`acount_prompt_tokens`
        before sending it.

        Args:
            text (str): The input text to chunk.
            max_tokens (int | None): Optional maximum tokens per chunk.
            overlap (int | None): Optional token overlap between chunks.

        Returns:
            list[DocumentChunk]: A list of document chunks.
        """
        cleaned_text = text.strip()
        if not cleaned_text:
            return []

        limit = max_tokens or self.max_context_tokens
        if limit is None:
            total_tokens = self.count_tokens(cleaned_text)
            return [DocumentChunk(text=cleaned_text, token_count=total_tokens, index=0)]

        words = cleaned_text.split()
        if not words:
            return []

        chunks = []
        overlap_tokens = overlap if overlap is not None else self.chunk_overlap
        current_words = []
        current_tokens = 0

        for word in words:
            if not current_words:
                current_words = [word]
                current_tokens = self.count_tokens(" ".join(current_words))
                if current_tokens > limit:
                    self._append_chunk(
                        chunks=chunks,
                        text=current_words[0],
                        token_count=current_tokens,
                    )
                    current_words = []
                    current_tokens = 0
                continue

            tentative_words = current_words + [word]
            tentative_text = " ".join(tentative_words)
            tentative_tokens = self.count_tokens(tentative_text)

            if tentative_tokens <= limit:
                current_words = tentative_words
                current_tokens = tentative_tokens
                continue

            chunk_text = " ".join(current_words)
            self._append_chunk(
                chunks=chunks,
                text=chunk_text,
                token_count=current_tokens,
            )

            carry_over = self._overlap_tail(current_words, overlap_tokens)
            current_words = carry_over + [word]
            current_tokens = self.count_tokens(" ".join(current_words))

            if current_tokens > limit:
                chunk_text = " ".join(current_words)
                self._append_chunk(
                    chunks=chunks,
                    text=chunk_text,
                    token_count=current_tokens,
                )
                current_words = []
                current_tokens = 0

        if current_words:
            chunk_text = " ".join(current_words)
            self._append_chunk(
                chunks=chunks,
                text=chunk_text,
                token_count=current_tokens,
                fallback_count=True,
            )

        return chunks

    def _tokenize(self, text: str) -> Sequence[Any]:
        """
        Tokenize text using the configured tokenizer or fallback to whitespace.

        Args:
            text (str): The input text to tokenize.

        Returns:
            Sequence[Any]: The sequence of tokens.
        """
        if self._tokenizer is None:
            return text.split()

        tokenizer = self._tokenizer
        if hasattr(tokenizer, "encode"):
            return tokenizer.encode(text)

        if callable(tokenizer):
            tokens = tokenizer(text)
            if isinstance(tokens, dict):
                return tokens.get("input_ids", [])
            return tokens

        return text.split()

    def _overlap_tail(self, words: list[str], overlap_tokens: int) -> list[str]:
        """
        Get the tail overlap of words based on the token budget.

        Args:
            words (list[str]): The list of words to consider for overlap.
            overlap_tokens (int): The token budget for the overlap. Must be
                non-negative.

        Returns:
            list[str]: The list of words representing the tail overlap.
        """
        assert overlap_tokens >= 0, "`overlap_tokens` must be non-negative."

        if not words or overlap_tokens == 0:
            return []

        tail = []

        for word in reversed(words):
            tail.insert(0, word)
            token_budget = self.count_tokens(" ".join(tail))
            if token_budget >= overlap_tokens:
                break

        return tail

    def _append_chunk(
        self,
        *,
        chunks: list[DocumentChunk],
        text: str,
        token_count: int,
        fallback_count: bool = False,
    ) -> None:
        """
        Append a chunk with consistent indexing, optionally recomputing token count if missing.

        Args:
            chunks (list[DocumentChunk]): Accumulated chunk list.
            text (str): Chunk text.
            token_count (int): Token count for the chunk.
            fallback_count (bool): Recompute token count when provided count is
                falsy. Defaults to False.
        """
        count = token_count or (
            self.count_tokens(text) if fallback_count else token_count
        )
        chunks.append(
            DocumentChunk(
                text=text,
                token_count=count,
                index=len(chunks),
            )
        )


__all__ = ["DocumentChunk", "LLMProvider", "LLMResponse"]
