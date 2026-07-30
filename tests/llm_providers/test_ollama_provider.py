from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from aymurai.llm_providers import OllamaLLMProvider


@pytest.fixture
def mock_chat():
    """Patch the synchronous `ollama.chat` entrypoint used by the provider."""
    with patch("aymurai.llm_providers.ollama_provider.ollama.chat") as mock:
        yield mock


@pytest.fixture
def mock_async_chat():
    """Patch `AsyncClient` and expose its awaitable `chat` mock."""
    client = MagicMock()
    client.chat = AsyncMock()
    with patch(
        "aymurai.llm_providers.ollama_provider.AsyncClient",
        return_value=client,
    ):
        yield client.chat


def test_generate_builds_messages(mock_chat):
    provider = OllamaLLMProvider(model="llama3", system_prompt="Sistema")
    mock_chat.return_value = {"message": {"content": "respuesta"}, "eval_count": 10}

    response = provider.generate("Hola")

    assert response.text == "respuesta"
    _, kwargs = mock_chat.call_args
    assert kwargs["model"] == "llama3"
    assert kwargs["messages"][0]["role"] == "system"
    assert response.metadata.get("model") == "llama3"
    assert response.metadata.get("provider") == "ollama"
    assert "eval_count" in response.metadata
    assert "eval_duration" in response.metadata


def test_generate_forwards_keep_alive(mock_chat):
    provider = OllamaLLMProvider(model="llama3", keep_alive=30)
    mock_chat.return_value = {"message": {"content": "ok"}}

    provider.generate("Hola")

    _, kwargs = mock_chat.call_args
    assert kwargs["keep_alive"] == 30


def test_stream_yields_chunks(mock_chat):
    provider = OllamaLLMProvider(model="llama3")
    mock_chat.return_value = iter(
        [
            {"message": {"content": "Hola"}, "done": False},
            {"message": {"content": " Mundo"}, "done": True},
        ]
    )

    pieces = list(provider.stream("Hola"))

    assert [piece.text for piece in pieces] == ["Hola", " Mundo"]
    _, kwargs = mock_chat.call_args
    assert kwargs["stream"] is True
    assert pieces[-1].metadata.get("done") is True


def test_generate_raises_without_prompt_or_messages():
    provider = OllamaLLMProvider(model="llama3")

    with pytest.raises(ValueError):
        provider.generate(prompt=None, messages=None)


def test_generate_prefers_explicit_messages_over_prompt(mock_chat):
    provider = OllamaLLMProvider(model="llama3", system_prompt="ignored")
    mock_chat.return_value = {"message": {"content": "ok"}}

    provider.generate(messages=[{"role": "user", "content": "explicit"}])

    _, kwargs = mock_chat.call_args
    assert kwargs["messages"] == [{"role": "user", "content": "explicit"}]


@pytest.mark.anyio
async def test_async_generate_builds_messages(mock_async_chat):
    provider = OllamaLLMProvider(model="llama3", system_prompt="Sistema")
    mock_async_chat.return_value = {
        "message": {"content": "respuesta"},
        "eval_count": 10,
    }

    response = await provider.async_generate("Hola")

    assert response.text == "respuesta"
    mock_async_chat.assert_awaited_once()
    _, kwargs = mock_async_chat.call_args
    assert kwargs["model"] == "llama3"
    assert kwargs["messages"][0]["role"] == "system"
    assert response.metadata.get("model") == "llama3"
    assert response.metadata.get("provider") == "ollama"
    assert "eval_count" in response.metadata


@pytest.mark.anyio
async def test_async_stream_yields_chunks(mock_async_chat):
    provider = OllamaLLMProvider(model="llama3")

    async def fake_stream():
        yield {"message": {"content": "Hola"}, "done": False}
        yield {"message": {"content": " Mundo"}, "done": True}

    mock_async_chat.return_value = fake_stream()

    chunks = [chunk async for chunk in provider.async_stream("Hola")]

    assert [chunk.text for chunk in chunks] == ["Hola", " Mundo"]
    mock_async_chat.assert_awaited()
    assert chunks[-1].metadata.get("done") is True
