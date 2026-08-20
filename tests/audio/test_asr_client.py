import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from aymurai.api.meta.asr.coro import CoroStreamDelta, CoroStreamSegments
from aymurai.audio.asr_client import (
    stream_transcribe_audio_bytes,
    transcribe_audio_bytes,
)
from aymurai.settings import settings


def _fake_event(event_type: str, **fields):
    return SimpleNamespace(type=event_type, **fields)


def test_transcribe_audio_bytes_raises_when_base_url_unset(monkeypatch):
    monkeypatch.setattr(settings, "TRANSCRIBE_BASE_URL", None)
    with pytest.raises(RuntimeError, match="TRANSCRIBE_BASE_URL"):
        asyncio.run(transcribe_audio_bytes(b"data", "f.wav", "audio/wav"))


def test_transcribe_audio_bytes_parses_done_frame(monkeypatch):
    monkeypatch.setattr(settings, "TRANSCRIBE_BASE_URL", "http://coro.local/v1")

    async def _fake_stream():
        yield _fake_event(
            "transcript.text.done",
            text='{"segments": [{"start": 0.0, "end": 1.0, "text": "hola", "speaker": "1"}]}',
        )

    mock_client = AsyncMock()
    mock_client.audio.transcriptions.create = AsyncMock(return_value=_fake_stream())

    with patch("aymurai.audio.asr_client.AsyncOpenAI", return_value=mock_client):
        segments = asyncio.run(transcribe_audio_bytes(b"data", "f.wav", "audio/wav"))

    assert len(segments) == 1
    assert segments[0].text == "hola"


def test_transcribe_audio_bytes_raises_runtime_error_when_no_done_frame(monkeypatch):
    monkeypatch.setattr(settings, "TRANSCRIBE_BASE_URL", "http://coro.local/v1")

    async def _fake_stream():
        yield _fake_event("transcript.text.delta", delta="partial")

    mock_client = AsyncMock()
    mock_client.audio.transcriptions.create = AsyncMock(return_value=_fake_stream())

    with patch("aymurai.audio.asr_client.AsyncOpenAI", return_value=mock_client):
        with pytest.raises(RuntimeError, match="done frame"):
            asyncio.run(transcribe_audio_bytes(b"data", "f.wav", "audio/wav"))


def test_stream_transcribe_audio_bytes_yields_deltas_then_segments(monkeypatch):
    monkeypatch.setattr(settings, "TRANSCRIBE_BASE_URL", "http://coro.local/v1")

    async def _fake_stream():
        yield _fake_event("transcript.text.delta", delta="ho")
        yield _fake_event("transcript.text.delta", delta="la")
        yield _fake_event(
            "transcript.text.done",
            text='{"segments": [{"start": 0.0, "end": 1.0, "text": "hola", "speaker": "1"}]}',
        )

    mock_client = AsyncMock()
    mock_client.audio.transcriptions.create = AsyncMock(return_value=_fake_stream())

    async def _collect():
        events = []
        with patch("aymurai.audio.asr_client.AsyncOpenAI", return_value=mock_client):
            async for event in stream_transcribe_audio_bytes(
                b"data", "f.wav", "audio/wav"
            ):
                events.append(event)
        return events

    events = asyncio.run(_collect())
    assert isinstance(events[0], CoroStreamDelta)
    assert isinstance(events[1], CoroStreamDelta)
    assert isinstance(events[2], CoroStreamSegments)
