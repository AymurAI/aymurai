import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from aymurai.llm_providers import OllamaLLMProvider
from aymurai.settings import settings

MODULE = "aymurai.llm_providers.openai_compatible_provider"


def _fake_completion(content: str) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2),
    )


def _fake_chunk(content: str | None, finish_reason: str | None = None):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                delta=SimpleNamespace(content=content),
                finish_reason=finish_reason,
            )
        ]
    )


class OllamaProviderTests(unittest.TestCase):
    def test_host_defaults_to_settings_and_appends_v1(self):
        with patch.object(settings, "OLLAMA_HOST", "http://ollama:11434"):
            provider = OllamaLLMProvider(model="llama3")

        self.assertEqual(provider.base_url, "http://ollama:11434/v1")

    def test_explicit_host_overrides_settings(self):
        provider = OllamaLLMProvider(model="llama3", host="http://other:9999/")

        self.assertEqual(provider.base_url, "http://other:9999/v1")

    def test_generate_builds_messages_and_maps_response(self):
        provider = OllamaLLMProvider(
            model="llama3", host="http://ollama:11434", system_prompt="Sistema"
        )
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("respuesta")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            response = provider.generate("Hola")

        self.assertEqual(response.text, "respuesta")
        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["model"], "llama3")
        self.assertEqual(kwargs["messages"][0]["role"], "system")
        self.assertEqual(response.metadata.get("provider"), "ollama")
        self.assertEqual(response.metadata.get("model"), "llama3")

    def test_generate_raises_without_prompt_or_messages(self):
        provider = OllamaLLMProvider(model="llama3")
        with self.assertRaises(ValueError):
            provider.generate(prompt=None, messages=None)

    def test_keep_alive_is_forwarded_via_extra_body(self):
        provider = OllamaLLMProvider(
            model="llama3", host="http://ollama:11434", keep_alive="1h"
        )
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola")

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["extra_body"], {"keep_alive": "1h"})

    def test_explicit_extra_body_keep_alive_wins_over_constructor_default(self):
        provider = OllamaLLMProvider(
            model="llama3", host="http://ollama:11434", keep_alive="1h"
        )
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola", extra_body={"keep_alive": "30m"})

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["extra_body"], {"keep_alive": "30m"})

    def test_no_keep_alive_means_no_extra_body(self):
        provider = OllamaLLMProvider(model="llama3", host="http://ollama:11434")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola")

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("extra_body", kwargs)

    def test_options_translation_is_inherited(self):
        provider = OllamaLLMProvider(model="llama3", host="http://ollama:11434")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola", options={"num_ctx": 16_384, "num_predict": 4096})

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("options", kwargs)
        self.assertNotIn("num_ctx", kwargs)
        self.assertEqual(kwargs["max_tokens"], 4096)

    def test_stream_yields_chunks_and_flags_done(self):
        provider = OllamaLLMProvider(model="llama3", host="http://ollama:11434")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = iter(
            [
                _fake_chunk("Hola"),
                _fake_chunk(" Mundo", finish_reason="stop"),
            ]
        )

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            pieces = list(provider.stream("Hola"))

        self.assertEqual([piece.text for piece in pieces], ["Hola", " Mundo"])
        self.assertTrue(pieces[-1].metadata.get("done"))


class AsyncOllamaProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_generate_builds_messages_and_maps_response(self):
        provider = OllamaLLMProvider(
            model="llama3", host="http://ollama:11434", system_prompt="Sistema"
        )
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_fake_completion("respuesta")
        )

        with patch(f"{MODULE}.AsyncOpenAI", return_value=mock_client):
            response = await provider.async_generate("Hola")

        self.assertEqual(response.text, "respuesta")
        mock_client.chat.completions.create.assert_awaited_once()
        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["messages"][0]["role"], "system")
        self.assertEqual(response.metadata.get("provider"), "ollama")

    async def test_async_stream_yields_chunks_and_flags_done(self):
        provider = OllamaLLMProvider(model="llama3", host="http://ollama:11434")

        async def fake_gen():
            yield _fake_chunk("Hola")
            yield _fake_chunk(" Mundo", finish_reason="stop")

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=fake_gen())

        with patch(f"{MODULE}.AsyncOpenAI", return_value=mock_client):
            pieces = []
            async for chunk in provider.async_stream("Hola"):
                pieces.append(chunk.text)

        self.assertEqual(pieces, ["Hola", " Mundo"])


if __name__ == "__main__":
    unittest.main()
