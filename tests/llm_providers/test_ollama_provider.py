import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from aymurai.llm_providers import OllamaLLMProvider


class OllamaProviderTests(unittest.TestCase):
    def test_generate_builds_messages(self):
        provider = OllamaLLMProvider(model="llama3", system_prompt="Sistema")
        fake_response = {"message": {"content": "respuesta"}, "eval_count": 10}
        with patch("aymurai.llm_providers.ollama_provider.ollama.chat") as mock_chat:
            mock_chat.return_value = fake_response
            response = provider.generate("Hola")

        self.assertEqual(response.text, "respuesta")
        _, kwargs = mock_chat.call_args
        self.assertEqual(kwargs["model"], "llama3")
        self.assertEqual(kwargs["messages"][0]["role"], "system")
        self.assertEqual(response.metadata.get("model"), "llama3")
        self.assertEqual(response.metadata.get("provider"), "ollama")
        self.assertIn("eval_count", response.metadata)
        self.assertIn("eval_duration", response.metadata)

    def test_generate_forwards_keep_alive(self):
        provider = OllamaLLMProvider(model="llama3", keep_alive=30)
        fake_response = {"message": {"content": "ok"}}
        with patch("aymurai.llm_providers.ollama_provider.ollama.chat") as mock_chat:
            mock_chat.return_value = fake_response
            _ = provider.generate("Hola")
        _, kwargs = mock_chat.call_args
        self.assertEqual(kwargs["keep_alive"], 30)

    def test_stream_yields_chunks(self):
        provider = OllamaLLMProvider(model="llama3")
        fake_chunks = iter(
            [
                {"message": {"content": "Hola"}, "done": False},
                {"message": {"content": " Mundo"}, "done": True},
            ]
        )
        with patch("aymurai.llm_providers.ollama_provider.ollama.chat") as mock_chat:
            mock_chat.return_value = fake_chunks
            pieces = list(provider.stream("Hola"))

        self.assertEqual([piece.text for piece in pieces], ["Hola", " Mundo"])
        _, kwargs = mock_chat.call_args
        self.assertTrue(kwargs["stream"])
        self.assertTrue(pieces[-1].metadata.get("done"))

    def test_generate_raises_without_prompt_or_messages(self):
        provider = OllamaLLMProvider(model="llama3")
        with self.assertRaises(ValueError):
            provider.generate(prompt=None, messages=None)

    def test_generate_prefers_explicit_messages_over_prompt(self):
        provider = OllamaLLMProvider(model="llama3", system_prompt="ignored")
        fake_response = {"message": {"content": "ok"}}
        with patch("aymurai.llm_providers.ollama_provider.ollama.chat") as mock_chat:
            mock_chat.return_value = fake_response
            provider.generate(messages=[{"role": "user", "content": "explicit"}])
        _, kwargs = mock_chat.call_args
        self.assertEqual(kwargs["messages"], [{"role": "user", "content": "explicit"}])


class AsyncOllamaProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_generate_builds_messages(self):
        provider = OllamaLLMProvider(model="llama3", system_prompt="Sistema")
        fake_response = {"message": {"content": "respuesta"}, "eval_count": 10}
        mock_client = MagicMock()
        mock_client.chat = AsyncMock(return_value=fake_response)

        with patch(
            "aymurai.llm_providers.ollama_provider.AsyncClient",
            return_value=mock_client,
        ):
            response = await provider.async_generate("Hola")

        self.assertEqual(response.text, "respuesta")
        mock_client.chat.assert_awaited_once()
        _, kwargs = mock_client.chat.call_args
        self.assertEqual(kwargs["model"], "llama3")
        self.assertEqual(kwargs["messages"][0]["role"], "system")
        self.assertEqual(response.metadata.get("model"), "llama3")
        self.assertEqual(response.metadata.get("provider"), "ollama")
        self.assertIn("eval_count", response.metadata)

    async def test_async_stream_yields_chunks(self):
        provider = OllamaLLMProvider(model="llama3")

        async def fake_gen():
            yield {"message": {"content": "Hola"}, "done": False}
            yield {"message": {"content": " Mundo"}, "done": True}

        mock_client = MagicMock()
        mock_client.chat = AsyncMock(return_value=fake_gen())

        with patch(
            "aymurai.llm_providers.ollama_provider.AsyncClient",
            return_value=mock_client,
        ):
            pieces = []
            last_chunk = None
            async for chunk in provider.async_stream("Hola"):
                pieces.append(chunk.text)
                last_chunk = chunk

        self.assertEqual(pieces, ["Hola", " Mundo"])
        mock_client.chat.assert_awaited()
        self.assertTrue(last_chunk.metadata.get("done"))


if __name__ == "__main__":
    unittest.main()
