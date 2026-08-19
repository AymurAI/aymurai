import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from aymurai.llm_providers import OpenAICompatibleLLMProvider

MODULE = "aymurai.llm_providers.openai_compatible_provider"


def _fake_completion(
    content: str,
    *,
    prompt_tokens: int = 5,
    completion_tokens: int = 7,
) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        ),
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


class OpenAICompatibleProviderTests(unittest.TestCase):
    def test_generate_builds_messages_and_maps_response(self):
        provider = OpenAICompatibleLLMProvider(
            model="local-model",
            base_url="http://server.local/v1",
            system_prompt="Sistema",
        )
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("respuesta")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client) as mock_openai:
            response = provider.generate("Hola")

        self.assertEqual(response.text, "respuesta")
        _, init_kwargs = mock_openai.call_args
        self.assertEqual(init_kwargs["base_url"], "http://server.local/v1")
        self.assertEqual(init_kwargs["api_key"], "not-needed")

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["model"], "local-model")
        self.assertEqual(
            kwargs["messages"],
            [
                {"role": "system", "content": "Sistema"},
                {"role": "user", "content": "Hola"},
            ],
        )
        self.assertEqual(response.metadata.get("model"), "local-model")
        self.assertEqual(response.metadata.get("provider"), "openai-compatible")
        self.assertEqual(response.metadata.get("prompt_tokens"), 5)
        self.assertEqual(response.metadata.get("completion_tokens"), 7)

    def test_generate_prefers_explicit_messages_over_prompt(self):
        provider = OpenAICompatibleLLMProvider(
            model="local-model", system_prompt="ignored"
        )
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate(messages=[{"role": "user", "content": "explicit"}])

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["messages"], [{"role": "user", "content": "explicit"}])

    def test_generate_raises_without_prompt_or_messages(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        with self.assertRaises(ValueError):
            provider.generate(prompt=None, messages=None)

    def test_generate_without_format_sends_no_response_format(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola")

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("response_format", kwargs)

    def test_stream_yields_chunks_and_flags_done(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
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
        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertTrue(kwargs["stream"])
        self.assertFalse(pieces[0].metadata.get("done"))
        self.assertTrue(pieces[-1].metadata.get("done"))
        self.assertEqual(pieces[-1].metadata.get("finish_reason"), "stop")

    def test_stream_maps_none_delta_content_to_empty_text(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = iter(
            [_fake_chunk(None, finish_reason="stop")]
        )

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            pieces = list(provider.stream("Hola"))

        self.assertEqual(pieces[0].text, "")

    def test_sync_client_is_cached_across_calls(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client) as mock_openai:
            provider.generate("Hola")
            provider.generate("Mundo")

        mock_openai.assert_called_once()
        self.assertEqual(mock_client.chat.completions.create.call_count, 2)

    def test_close_releases_the_cached_sync_client(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola")
            provider.close()

        mock_client.close.assert_called_once()
        self.assertIsNone(provider._client)

    def test_close_is_a_safe_no_op_when_no_client_was_ever_created(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")

        provider.close()  # must not raise

    def test_close_recreates_a_fresh_client_on_next_use(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client) as mock_openai:
            provider.generate("Hola")
            provider.close()
            provider.generate("Mundo")

        self.assertEqual(mock_openai.call_count, 2)

    def test_model_kwarg_is_rejected_with_a_clear_error(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")

        with self.assertRaises(ValueError):
            provider._build_request_kwargs({"model": "other"})


class AsyncOpenAICompatibleProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_generate_builds_messages_and_maps_response(self):
        provider = OpenAICompatibleLLMProvider(
            model="local-model",
            base_url="http://server.local/v1",
            system_prompt="Sistema",
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
        self.assertEqual(kwargs["model"], "local-model")
        self.assertEqual(kwargs["messages"][0]["role"], "system")
        self.assertEqual(response.metadata.get("provider"), "openai-compatible")
        self.assertEqual(response.metadata.get("prompt_tokens"), 5)

    async def test_async_stream_yields_chunks_and_flags_done(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")

        async def fake_gen():
            yield _fake_chunk("Hola")
            yield _fake_chunk(" Mundo", finish_reason="stop")

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=fake_gen())

        with patch(f"{MODULE}.AsyncOpenAI", return_value=mock_client):
            pieces = []
            last_chunk = None
            async for chunk in provider.async_stream("Hola"):
                pieces.append(chunk.text)
                last_chunk = chunk

        self.assertEqual(pieces, ["Hola", " Mundo"])
        mock_client.chat.completions.create.assert_awaited()
        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertTrue(kwargs["stream"])
        self.assertTrue(last_chunk.metadata.get("done"))

    async def test_async_client_is_cached_across_calls(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_fake_completion("ok")
        )

        with patch(
            f"{MODULE}.AsyncOpenAI", return_value=mock_client
        ) as mock_async_openai:
            await provider.async_generate("Hola")
            await provider.async_generate("Mundo")

        mock_async_openai.assert_called_once()
        self.assertEqual(mock_client.chat.completions.create.await_count, 2)

    async def test_aclose_releases_the_cached_async_client(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_fake_completion("ok")
        )
        mock_client.close = AsyncMock()

        with patch(f"{MODULE}.AsyncOpenAI", return_value=mock_client):
            await provider.async_generate("Hola")
            await provider.aclose()

        mock_client.close.assert_awaited_once()
        self.assertIsNone(provider._async_client)

    async def test_aclose_is_a_safe_no_op_when_no_client_was_ever_created(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")

        await provider.aclose()  # must not raise


if __name__ == "__main__":
    unittest.main()
