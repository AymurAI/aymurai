import unittest

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


class BaseProviderTests(unittest.TestCase):
    def test_chunk_text_respects_token_limit(self):
        provider = DummyProvider(max_context_tokens=4, chunk_overlap=1)
        text = "uno dos tres cuatro cinco seis"
        chunks = provider.chunk_text(text)
        self.assertGreater(len(chunks), 1)
        for i, chunk in enumerate(chunks):
            self.assertEqual(chunk.index, i)
            self.assertLessEqual(chunk.token_count, 4)

    def test_chunk_text_overlap_applied(self):
        provider = DummyProvider(max_context_tokens=3, chunk_overlap=1)
        text = "one two three four"
        chunks = provider.chunk_text(text)
        self.assertEqual([c.index for c in chunks], [0, 1])
        self.assertTrue(chunks[0].text.split()[-1] in chunks[1].text.split())

    def test_chunk_text_fallback_count(self):
        provider = DummyProvider(max_context_tokens=1)
        provider._tokenizer = type("EmptyTok", (), {"encode": lambda self, t: []})()
        chunks = provider.chunk_text("hello")
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].token_count, 0)

    def test_chunk_text_returns_empty_list_for_blank_text(self):
        provider = DummyProvider(max_context_tokens=4)
        self.assertEqual(provider.chunk_text("   "), [])

    def test_chunk_text_without_limit_returns_single_chunk(self):
        provider = DummyProvider()
        chunks = provider.chunk_text("uno dos tres")
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].token_count, 3)

    def test_count_tokens_uses_tokenizer_encode_when_available(self):
        class FakeTokenizer:
            def encode(self, text):
                return text.split()

        provider = DummyProvider(tokenizer=FakeTokenizer())
        self.assertEqual(provider.count_tokens("uno dos tres"), 3)

    def test_generate_returns_llm_response(self):
        provider = DummyProvider()
        response = provider.generate("hola")
        self.assertEqual(response.text, "echo::hola")

    def test_stream_raises_not_implemented_by_default(self):
        provider = DummyProvider()
        with self.assertRaises(NotImplementedError):
            provider.stream("hola")


if __name__ == "__main__":
    unittest.main()
