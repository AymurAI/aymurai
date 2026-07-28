import json
from collections.abc import AsyncGenerator

from openai import APIConnectionError, APIError, AsyncOpenAI

from aymurai.api.meta.asr.coro import (
    CoroSegment,
    CoroStreamDelta,
    CoroStreamEvent,
    CoroStreamSegments,
)
from aymurai.logger import get_logger
from aymurai.settings import settings

logger = get_logger(__name__)

DONE_EVENT_TYPE = "transcript.text.done"
DELTA_EVENT_TYPE = "transcript.text.delta"


async def transcribe_audio_bytes(
    payload: bytes,
    filename: str,
    content_type: str,
) -> list[CoroSegment]:
    base_url = settings.TRANSCRIBE_BASE_URL
    if not base_url:
        raise RuntimeError("TRANSCRIBE_BASE_URL is not configured")

    client = AsyncOpenAI(base_url=base_url, api_key=settings.TRANSCRIBE_API_KEY)

    logger.info("streaming audio to coro for transcription")
    try:
        stream = await client.audio.transcriptions.create(
            file=(filename, payload, content_type),
            model="whisper-1",
            language="es",
            stream=True,
            response_format="diarized_json",
        )
        async for event in stream:
            if event.type == DONE_EVENT_TYPE:
                data = json.loads(event.text)
                return [
                    CoroSegment.model_validate(segment)
                    for segment in data.get("segments", [])
                ]
    except (APIError, APIConnectionError) as exc:
        logger.error("coro transcription error: %s", exc)
        raise RuntimeError("Transcription service error") from exc

    raise RuntimeError("coro stream ended without a done frame")


async def stream_transcribe_audio_bytes(
    payload: bytes,
    filename: str,
    content_type: str,
) -> AsyncGenerator[CoroStreamEvent, None]:
    base_url = settings.TRANSCRIBE_BASE_URL
    if not base_url:
        raise RuntimeError("TRANSCRIBE_BASE_URL is not configured")

    client = AsyncOpenAI(base_url=base_url, api_key=settings.TRANSCRIBE_API_KEY)

    logger.info("streaming audio to coro for transcription (sse)")
    try:
        stream = await client.audio.transcriptions.create(
            file=(filename, payload, content_type),
            model="whisper-1",
            language="es",
            stream=True,
            response_format="diarized_json",
        )
        async for event in stream:
            if event.type == DELTA_EVENT_TYPE:
                yield CoroStreamDelta(text=event.delta or "")
            elif event.type == DONE_EVENT_TYPE:
                data = json.loads(event.text)
                yield CoroStreamSegments(
                    segments=[
                        CoroSegment.model_validate(segment)
                        for segment in data.get("segments", [])
                    ]
                )
                return
    except (APIError, APIConnectionError) as exc:
        logger.error("coro transcription error: %s", exc)
        raise RuntimeError("Transcription service error") from exc

    raise RuntimeError("coro stream ended without a done frame")
