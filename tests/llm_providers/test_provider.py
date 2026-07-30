import pytest

from aymurai.llm_providers.provider import LLMProvider, LLMResponse


class DummyProvider(LLMProvider):
    def __init__(self, **kwargs):
        super().__init__(model="dummy", **kwargs)
        self.last_prompt = None

    def generate(self, prompt: str, **kwargs) -> LLMResponse:
        self.last_prompt = prompt
        return LLMResponse(text=f"echo::{prompt}")

    def stream(self, prompt, **kwargs):
        return super().stream(prompt, **kwargs)


class WhitespaceTokenizer:
    """Tokenizer exposing the `encode` interface expected by the provider."""

    def encode(self, text: str) -> list[str]:
        return text.split()


class EmptyTokenizer:
    """Tokenizer that always yields zero tokens, exercising fallback counting."""

    def encode(self, text: str) -> list[str]:
        return []


def test_chunk_text_respects_token_limit():
    provider = DummyProvider(max_context_tokens=4, chunk_overlap=1)

    chunks = provider.chunk_text("uno dos tres cuatro cinco seis")

    assert len(chunks) > 1
    assert [chunk.index for chunk in chunks] == list(range(len(chunks)))
    assert all(chunk.token_count <= 4 for chunk in chunks)


def test_chunk_text_overlap_applied():
    provider = DummyProvider(max_context_tokens=3, chunk_overlap=1)

    chunks = provider.chunk_text("one two three four")

    assert [chunk.index for chunk in chunks] == [0, 1]
    assert chunks[0].text.split()[-1] in chunks[1].text.split()


def test_chunk_text_fallback_count():
    provider = DummyProvider(max_context_tokens=1, tokenizer=EmptyTokenizer())

    chunks = provider.chunk_text("hello")

    assert len(chunks) == 1
    assert chunks[0].token_count == 0


def test_chunk_text_returns_empty_list_for_blank_text():
    provider = DummyProvider(max_context_tokens=4)

    assert provider.chunk_text("   ") == []


def test_chunk_text_without_limit_returns_single_chunk():
    provider = DummyProvider()

    chunks = provider.chunk_text("uno dos tres")

    assert len(chunks) == 1
    assert chunks[0].token_count == 3


def test_count_tokens_uses_tokenizer_encode_when_available():
    provider = DummyProvider(tokenizer=WhitespaceTokenizer())

    assert provider.count_tokens("uno dos tres") == 3


def test_generate_returns_llm_response():
    provider = DummyProvider()

    response = provider.generate("hola")

    assert response.text == "echo::hola"


def test_stream_raises_not_implemented_by_default():
    provider = DummyProvider()

    with pytest.raises(NotImplementedError):
        provider.stream("hola")
