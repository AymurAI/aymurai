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

    async def async_generate(self, prompt: str, **kwargs) -> LLMResponse:
        return await super().async_generate(prompt, **kwargs)

    async def async_stream(self, prompt, **kwargs):
        async for item in super().async_stream(prompt, **kwargs):
            yield item


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


@pytest.mark.anyio
async def test_async_stream_raises_not_implemented_by_default():
    provider = DummyProvider()

    with pytest.raises(NotImplementedError):
        async for _ in provider.async_stream("hola"):
            pass


@pytest.mark.anyio
async def test_async_generate_raises_not_implemented_by_default():
    provider = DummyProvider()

    with pytest.raises(NotImplementedError):
        await provider.async_generate("hola")


def test_count_prompt_tokens_default_flattens_messages():
    provider = DummyProvider(tokenizer=WhitespaceTokenizer())

    count = provider.count_prompt_tokens(
        messages=[
            {"role": "system", "content": "uno dos"},
            {"role": "user", "content": "tres cuatro cinco"},
        ]
    )

    assert count == 5


def test_count_prompt_tokens_default_uses_prompt_when_no_messages():
    provider = DummyProvider(tokenizer=WhitespaceTokenizer())

    assert provider.count_prompt_tokens(prompt="uno dos tres") == 3


def test_count_prompt_tokens_default_prompt_none_and_messages_none_is_empty():
    provider = DummyProvider(tokenizer=WhitespaceTokenizer())

    assert provider.count_prompt_tokens() == 0


@pytest.mark.anyio
async def test_acount_prompt_tokens_default_delegates_to_sync():
    provider = DummyProvider(tokenizer=WhitespaceTokenizer())

    count = await provider.acount_prompt_tokens(prompt="uno dos tres cuatro")

    assert count == 4


def test_close_is_a_no_op_by_default():
    provider = DummyProvider()

    provider.close()  # must not raise


@pytest.mark.anyio
async def test_aclose_is_a_no_op_by_default():
    provider = DummyProvider()

    await provider.aclose()  # must not raise
