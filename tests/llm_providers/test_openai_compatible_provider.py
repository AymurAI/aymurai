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

    def test_format_schema_is_translated_to_response_format(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        schema = {
            "title": "CanonicalEntities",
            "type": "object",
            "properties": {"canonical_entities": {"type": "array"}},
        }
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("{}")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola", format=schema)

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("format", kwargs)
        self.assertEqual(
            kwargs["response_format"],
            {
                "type": "json_schema",
                "json_schema": {"name": "CanonicalEntities", "schema": schema},
            },
        )

    def test_format_schema_without_title_falls_back_to_response_name(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        schema = {"type": "object", "properties": {}}
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("{}")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola", format=schema)

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["response_format"]["json_schema"]["name"], "response")

    def test_format_json_string_maps_to_json_object(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("{}")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola", format="json")

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["response_format"], {"type": "json_object"})

    def test_explicit_response_format_wins_and_is_forwarded_untouched(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        explicit = {"type": "json_object"}
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("{}")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate(
                "Hola",
                format={"title": "Ignored", "type": "object"},
                response_format=explicit,
            )

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["response_format"], explicit)
        self.assertNotIn("format", kwargs)

    def test_generate_without_format_sends_no_response_format(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola")

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("response_format", kwargs)

    def test_options_num_predict_maps_to_max_tokens(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola", options={"num_predict": 4096})

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("options", kwargs)
        self.assertNotIn("num_predict", kwargs)
        self.assertEqual(kwargs["max_tokens"], 4096)

    def test_options_sampling_params_pass_through(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate(
                "Hola",
                options={
                    "temperature": 0.0,
                    "top_p": 0.9,
                    "stop": ["\n\n"],
                    "seed": 42,
                },
            )

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["temperature"], 0.0)
        self.assertEqual(kwargs["top_p"], 0.9)
        self.assertEqual(kwargs["stop"], ["\n\n"])
        self.assertEqual(kwargs["seed"], 42)

    def test_options_num_ctx_is_dropped(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola", options={"num_ctx": 16_384, "num_predict": 4096})

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("num_ctx", kwargs)
        self.assertEqual(kwargs["max_tokens"], 4096)

    def test_options_unknown_key_is_dropped(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola", options={"mirostat_tau": 5.0, "seed": 7})

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("mirostat_tau", kwargs)
        self.assertEqual(kwargs["seed"], 7)

    def test_options_none_or_absent_is_a_no_op(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola", options=None)
            provider.generate("Hola")

        for call in mock_client.chat.completions.create.call_args_list:
            _, kwargs = call
            self.assertNotIn("options", kwargs)
            self.assertNotIn("max_tokens", kwargs)
            self.assertNotIn("temperature", kwargs)
            self.assertEqual(set(kwargs), {"model", "messages"})

    def test_explicit_kwarg_wins_over_translated_option(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_completion("ok")

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            provider.generate("Hola", max_tokens=128, options={"num_predict": 4096})

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(kwargs["max_tokens"], 128)

    def test_stream_translates_options(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = iter(
            [_fake_chunk("Hola", finish_reason="stop")]
        )

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            list(
                provider.stream(
                    "Hola", options={"num_ctx": 16_384, "num_predict": 4096}
                )
            )

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("options", kwargs)
        self.assertNotIn("num_ctx", kwargs)
        self.assertEqual(kwargs["max_tokens"], 4096)
        self.assertTrue(kwargs["stream"])

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

    async def test_async_generate_translates_options(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_fake_completion("ok")
        )

        with patch(f"{MODULE}.AsyncOpenAI", return_value=mock_client):
            await provider.async_generate(
                "Hola",
                options={"num_ctx": 16_384, "num_predict": 4096, "temperature": 0.0},
            )

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("options", kwargs)
        self.assertNotIn("num_ctx", kwargs)
        self.assertEqual(kwargs["max_tokens"], 4096)
        self.assertEqual(kwargs["temperature"], 0.0)

    async def test_async_stream_translates_options(self):
        provider = OpenAICompatibleLLMProvider(model="local-model")

        async def fake_gen():
            yield _fake_chunk("Hola", finish_reason="stop")

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=fake_gen())

        with patch(f"{MODULE}.AsyncOpenAI", return_value=mock_client):
            async for _ in provider.async_stream(
                "Hola",
                options={"num_ctx": 16_384, "num_predict": 4096},
            ):
                pass

        _, kwargs = mock_client.chat.completions.create.call_args
        self.assertNotIn("options", kwargs)
        self.assertNotIn("num_ctx", kwargs)
        self.assertEqual(kwargs["max_tokens"], 4096)
        self.assertTrue(kwargs["stream"])


if __name__ == "__main__":
    unittest.main()
