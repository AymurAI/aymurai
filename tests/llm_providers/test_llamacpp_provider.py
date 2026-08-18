import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from aymurai.llm_providers import LlamaCppLLMProvider, ServedModel
from aymurai.llm_providers.llamacpp_provider import UNRESOLVED_MODEL
from aymurai.settings import settings

MODULE = "aymurai.llm_providers.openai_compatible_provider"
LLAMACPP_MODULE = "aymurai.llm_providers.llamacpp_provider"


def _fake_http_response(payload: dict) -> MagicMock:
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


def _fake_completion(content: str) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2),
    )


def test_defaults_resolve_from_settings(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    monkeypatch.setattr(settings, "LLAMACPP_API_KEY", "secret")

    provider = LlamaCppLLMProvider()

    assert provider.base_url == "http://llamacpp:8080/v1"
    assert provider.api_key == "secret"
    assert provider.model_name == UNRESOLVED_MODEL


def test_explicit_arguments_override_settings(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    monkeypatch.setattr(settings, "LLAMACPP_API_KEY", "secret")

    provider = LlamaCppLLMProvider(
        model="qwen3",
        base_url="http://other:9090/v1",
        api_key="override",
    )

    assert provider.model_name == "qwen3"
    assert provider.base_url == "http://other:9090/v1"
    assert provider.api_key == "override"


def test_forwards_system_prompt_to_base_provider(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider(system_prompt="Sistema")

    assert provider.system_prompt == "Sistema"


def test_metadata_provider_is_llamacpp(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider()
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _fake_completion("ok")

    with patch(f"{MODULE}.OpenAI", return_value=mock_client):
        response = provider.generate("Hola")

    assert response.text == "ok"
    assert response.metadata["provider"] == "llamacpp"
    assert response.metadata["model"] == UNRESOLVED_MODEL


def test_raises_without_base_url_configured(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", None)

    with pytest.raises(ValueError, match="LLAMACPP_BASE_URL"):
        LlamaCppLLMProvider()


def test_explicit_base_url_satisfies_the_guard_even_without_settings(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", None)

    provider = LlamaCppLLMProvider(base_url="http://other:9090/v1")

    assert provider.base_url == "http://other:9090/v1"


def test_resolve_served_model_reads_id_context_and_capabilities(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider()

    served = SimpleNamespace(id="gemma-4-e4b", model_extra={"meta": {"n_ctx": 8192}})
    mock_client = MagicMock()
    mock_client.models.list.return_value = [served]
    mock_client.get.return_value = {
        "models": [{"capabilities": ["completion", "multimodal"]}]
    }

    with patch(f"{MODULE}.OpenAI", return_value=mock_client):
        result = provider.resolve_served_model()

    assert result == ServedModel(
        id="gemma-4-e4b", n_ctx=8192, capabilities=("completion", "multimodal")
    )
    mock_client.get.assert_called_once_with("/models", cast_to=object)


def test_resolve_served_model_warns_and_uses_first_when_multiple_reported(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider()

    first = SimpleNamespace(id="first", model_extra={})
    second = SimpleNamespace(id="second", model_extra={})
    mock_client = MagicMock()
    mock_client.models.list.return_value = [first, second]
    mock_client.get.return_value = {"models": []}

    with patch(f"{MODULE}.OpenAI", return_value=mock_client):
        result = provider.resolve_served_model()

    assert result.id == "first"


def test_resolve_served_model_raises_when_no_models_reported(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider()

    mock_client = MagicMock()
    mock_client.models.list.return_value = []

    with (
        patch(f"{MODULE}.OpenAI", return_value=mock_client),
        pytest.raises(RuntimeError, match="reported no served models"),
    ):
        provider.resolve_served_model()


def test_resolve_served_model_capabilities_default_empty_on_fetch_failure(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider()

    served = SimpleNamespace(id="gemma-4-e4b", model_extra={"meta": {"n_ctx": 4096}})
    mock_client = MagicMock()
    mock_client.models.list.return_value = [served]
    mock_client.get.side_effect = RuntimeError("boom")

    with patch(f"{MODULE}.OpenAI", return_value=mock_client):
        result = provider.resolve_served_model()

    assert result.n_ctx == 4096
    assert result.capabilities == ()


def test_count_prompt_tokens_renders_template_then_tokenizes(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider(system_prompt="Sistema")
    mock_raw_client = MagicMock()
    mock_raw_client.post.side_effect = [
        _fake_http_response(
            {"prompt": "<|turn>system\nSistema<turn|>\n<|turn>user\nHola<turn|>\n"}
        ),
        _fake_http_response({"tokens": [1, 2, 3, 4, 5]}),
    ]

    with patch(f"{LLAMACPP_MODULE}.httpx.Client", return_value=mock_raw_client):
        count = provider.count_prompt_tokens(prompt="Hola")

    assert count == 5
    apply_template_call, tokenize_call = mock_raw_client.post.call_args_list
    assert apply_template_call.args[0] == "/apply-template"
    assert apply_template_call.kwargs["json"]["messages"] == [
        {"role": "system", "content": "Sistema"},
        {"role": "user", "content": "Hola"},
    ]
    assert tokenize_call.args[0] == "/tokenize"
    assert tokenize_call.kwargs["json"] == {
        "content": "<|turn>system\nSistema<turn|>\n<|turn>user\nHola<turn|>\n",
        "add_special": True,
    }


def test_count_prompt_tokens_reflects_whatever_the_server_actually_renders(monkeypatch):
    """
    The exact count comes from tokenizing the server's *rendered* template
    string, not the raw message content — so it reflects however much markup
    (turn/role markers, reasoning preamble, BOS, ...) the server adds, without
    this provider needing to know or reimplement that template itself.
    """
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider(system_prompt="Sistema")
    rendered = "<|turn>system\n<|think|>\nSistema<turn|>\n<|turn>user\nHola<turn|>\n<|turn>model\n"
    tokenized = list(
        range(len(rendered.split()))
    )  # stand-in token ids, one per whitespace word
    mock_raw_client = MagicMock()
    mock_raw_client.post.side_effect = [
        _fake_http_response({"prompt": rendered}),
        _fake_http_response({"tokens": tokenized}),
    ]

    with patch(f"{LLAMACPP_MODULE}.httpx.Client", return_value=mock_raw_client):
        count = provider.count_prompt_tokens(prompt="Hola")

    assert count == len(tokenized)
    tokenize_call = mock_raw_client.post.call_args_list[1]
    assert tokenize_call.kwargs["json"]["content"] == rendered


def test_count_prompt_tokens_propagates_failures(monkeypatch):
    """No estimator remains to fall back to, so failures must not be swallowed."""
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    provider = LlamaCppLLMProvider(system_prompt="Sistema")
    mock_raw_client = MagicMock()
    mock_raw_client.post.side_effect = RuntimeError("connection refused")

    with (
        patch(f"{LLAMACPP_MODULE}.httpx.Client", return_value=mock_raw_client),
        pytest.raises(RuntimeError, match="connection refused"),
    ):
        provider.count_prompt_tokens(prompt="Hola")


def test_tokenize_pieces_returns_token_pieces(monkeypatch):
    from aymurai.llm_providers.tokens import TokenPiece

    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    provider = LlamaCppLLMProvider()
    mock_raw_client = MagicMock()
    mock_raw_client.post.return_value = _fake_http_response(
        {"tokens": [{"id": 1, "piece": "Hola"}, {"id": 2, "piece": " mundo"}]}
    )

    with patch(f"{LLAMACPP_MODULE}.httpx.Client", return_value=mock_raw_client):
        pieces = provider.tokenize_pieces("Hola mundo")

    assert pieces == [TokenPiece(id=1, piece="Hola"), TokenPiece(id=2, piece=" mundo")]
    _, kwargs = mock_raw_client.post.call_args
    assert kwargs["json"]["with_pieces"] is True
    assert kwargs["json"]["add_special"] is False


def test_tokenize_returns_plain_ids(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    provider = LlamaCppLLMProvider()
    mock_raw_client = MagicMock()
    mock_raw_client.post.return_value = _fake_http_response({"tokens": [7, 8, 9]})

    with patch(f"{LLAMACPP_MODULE}.httpx.Client", return_value=mock_raw_client):
        tokens = provider.tokenize("hola", add_special=True)

    assert tokens == [7, 8, 9]
    _, kwargs = mock_raw_client.post.call_args
    assert kwargs["json"]["add_special"] is True
    assert "with_pieces" not in kwargs["json"]


def test_render_prompt_sends_no_chat_template_kwargs(monkeypatch):
    """Preflight must inherit server config, exactly like inference does."""
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    provider = LlamaCppLLMProvider()
    mock_raw_client = MagicMock()
    mock_raw_client.post.return_value = _fake_http_response({"prompt": "<rendered>"})

    with patch(f"{LLAMACPP_MODULE}.httpx.Client", return_value=mock_raw_client):
        rendered = provider.render_prompt([{"role": "user", "content": "hola"}])

    assert rendered == "<rendered>"
    _, kwargs = mock_raw_client.post.call_args
    assert "chat_template_kwargs" not in kwargs["json"]


def test_model_defaults_to_the_unresolved_placeholder(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    assert LlamaCppLLMProvider().model_name == UNRESOLVED_MODEL


def test_server_root_strips_the_v1_path():
    provider = LlamaCppLLMProvider(base_url="http://llamacpp:8080/v1")

    assert provider._server_root() == "http://llamacpp:8080/"


def test_close_releases_the_raw_sync_client(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    provider = LlamaCppLLMProvider()
    mock_raw_client = MagicMock()
    mock_raw_client.post.side_effect = [
        _fake_http_response({"prompt": "rendered"}),
        _fake_http_response({"tokens": [1]}),
    ]

    with patch(f"{LLAMACPP_MODULE}.httpx.Client", return_value=mock_raw_client):
        provider.count_prompt_tokens(prompt="hi")
        provider.close()

    mock_raw_client.close.assert_called_once()
    assert provider._raw_client is None


class AsyncLlamaCppProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_aresolve_served_model_reads_id_context_and_capabilities(self):
        with patch.object(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1"):
            provider = LlamaCppLLMProvider()

        served = SimpleNamespace(
            id="gemma-4-e4b", model_extra={"meta": {"n_ctx": 8192}}
        )

        async def _models_page():
            yield served

        mock_client = MagicMock()
        mock_client.models.list = AsyncMock(return_value=_models_page())
        mock_client.get = AsyncMock(
            return_value={"models": [{"capabilities": ["completion"]}]}
        )

        with patch(f"{MODULE}.AsyncOpenAI", return_value=mock_client):
            result = await provider.aresolve_served_model()

        self.assertEqual(
            result,
            ServedModel(id="gemma-4-e4b", n_ctx=8192, capabilities=("completion",)),
        )

    async def test_aresolve_served_model_is_memoized(self):
        with patch.object(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1"):
            provider = LlamaCppLLMProvider()

        served = SimpleNamespace(id="m", model_extra={"meta": {"n_ctx": 8192}})

        async def _page():
            yield served

        mock_client = MagicMock()
        mock_client.models.list = AsyncMock(return_value=_page())
        mock_client.get = AsyncMock(return_value={"models": []})

        with patch(f"{MODULE}.AsyncOpenAI", return_value=mock_client):
            first = await provider.aresolve_served_model()
            second = await provider.aresolve_served_model()

        self.assertIs(first, second)
        mock_client.models.list.assert_awaited_once()

    async def test_resolve_served_model_reads_n_ctx_train(self):
        with patch.object(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1"):
            provider = LlamaCppLLMProvider()

        served = SimpleNamespace(
            id="gemma-4-e4b",
            model_extra={"meta": {"n_ctx": 8192, "n_ctx_train": 131072}},
        )
        mock_client = MagicMock()
        mock_client.models.list.return_value = [served]
        mock_client.get.return_value = {"models": []}

        with patch(f"{MODULE}.OpenAI", return_value=mock_client):
            result = provider.resolve_served_model()

        self.assertEqual(result.n_ctx, 8192)
        self.assertEqual(result.n_ctx_train, 131072)

    async def test_acount_prompt_tokens_renders_template_then_tokenizes(self):
        with patch.object(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1"):
            provider = LlamaCppLLMProvider(system_prompt="Sistema")

        mock_raw_client = MagicMock()
        mock_raw_client.post = AsyncMock(
            side_effect=[
                _fake_http_response(
                    {
                        "prompt": "<|turn>system\nSistema<turn|>\n<|turn>user\nHola<turn|>\n"
                    }
                ),
                _fake_http_response({"tokens": [1, 2, 3, 4, 5, 6]}),
            ]
        )

        with patch(
            f"{LLAMACPP_MODULE}.httpx.AsyncClient", return_value=mock_raw_client
        ):
            count = await provider.acount_prompt_tokens(prompt="Hola")

        self.assertEqual(count, 6)
        apply_template_call, tokenize_call = mock_raw_client.post.call_args_list
        self.assertEqual(apply_template_call.args[0], "/apply-template")
        self.assertEqual(tokenize_call.args[0], "/tokenize")
        self.assertTrue(tokenize_call.kwargs["json"]["add_special"])

    async def test_acount_prompt_tokens_propagates_failures(self):
        with patch.object(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1"):
            provider = LlamaCppLLMProvider(system_prompt="Sistema")

        mock_raw_client = MagicMock()
        mock_raw_client.post = AsyncMock(side_effect=RuntimeError("connection refused"))

        with (
            patch(f"{LLAMACPP_MODULE}.httpx.AsyncClient", return_value=mock_raw_client),
            self.assertRaisesRegex(RuntimeError, "connection refused"),
        ):
            await provider.acount_prompt_tokens(prompt="Hola mundo")

    async def test_aclose_releases_the_raw_async_client(self):
        with patch.object(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1"):
            provider = LlamaCppLLMProvider()

        mock_raw_client = MagicMock()
        mock_raw_client.post = AsyncMock(
            side_effect=[
                _fake_http_response({"prompt": "rendered"}),
                _fake_http_response({"tokens": [1]}),
            ]
        )
        mock_raw_client.aclose = AsyncMock()

        with patch(
            f"{LLAMACPP_MODULE}.httpx.AsyncClient", return_value=mock_raw_client
        ):
            await provider.acount_prompt_tokens(prompt="hi")
            await provider.aclose()

        mock_raw_client.aclose.assert_awaited_once()
        self.assertIsNone(provider._raw_async_client)
