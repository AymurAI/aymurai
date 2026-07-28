import json
import math
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import Body, Depends, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRouter
from sqlmodel import Session

from aymurai.api.exceptions import (
    AymuraiAPIException,
    ConfigurationError,
    NotFoundError,
    UpstreamServiceError,
)
from aymurai.api.meta.asr.coro import (
    CoroSegment,
    CoroStreamDelta,
    CoroStreamSegments,
)
from aymurai.audio.asr_client import (
    stream_transcribe_audio_bytes,
    transcribe_audio_bytes,
)
from aymurai.audio.duration import probe_audio_duration
from aymurai.audio.transcript import (
    speaker_turns_from_validated_paragraphs,
    transcript_turns,
)
from aymurai.database.crud.audio_transcription import (
    audio_transcription_create_or_update,
    audio_transcription_get,
)
from aymurai.database.session import get_session
from aymurai.database.utils import data_to_uuid
from aymurai.logger import get_logger
from aymurai.meta.api_interfaces import (
    ASRDocument,
    ASRParagraph,
    ASRParagraphRequest,
    ASRSpeakerTurn,
    ASRValidationDocumentRequest,
)
from aymurai.settings import settings

router = APIRouter()
logger = get_logger(__name__)

# Progress estimation tuning. CHARS_PER_SEC biases the estimate: higher values
# make the bar lag and snap to 100% on completion rather than peg early. K =
# ln(10) puts the displayed value at ~90% when the char estimate thinks
# transcription is done (raw == 1.0).
ASR_PROGRESS_CHARS_PER_SEC = 17.0
ASR_PROGRESS_K = math.log(10)


def _estimate_progress(cumulative_chars: int, duration_s: float | None) -> float | None:
    if not duration_s or duration_s <= 0:
        return None
    raw = cumulative_chars / (duration_s * ASR_PROGRESS_CHARS_PER_SEC)
    value = 1.0 - math.exp(-ASR_PROGRESS_K * raw)
    return min(value, math.nextafter(1.0, 0.0))


def _segments_to_paragraphs(segments: list[CoroSegment]) -> list[ASRParagraph]:
    return [
        ASRParagraph(
            speaker_no=int(segment.speaker),
            start=segment.start,
            end=segment.end,
            text=segment.text,
        )
        for segment in segments
    ]


def _speaker_turns_for_transcription(
    paragraphs: list[ASRParagraph],
) -> list[ASRSpeakerTurn]:
    if not paragraphs:
        return []
    return [
        ASRSpeakerTurn.model_validate(turn)
        for turn in transcript_turns({"document": paragraphs})
    ]


def _speaker_turns_for_validation(
    paragraphs: list[ASRParagraph],
) -> list[ASRSpeakerTurn]:
    return [
        ASRSpeakerTurn.model_validate(turn)
        for turn in speaker_turns_from_validated_paragraphs(paragraphs)
    ]


def _asr_document_from_transcription(
    document_id: uuid.UUID, paragraphs: list[ASRParagraph], title: str | None = None
) -> ASRDocument:
    return ASRDocument(
        document_id=document_id,
        title=title,
        document=paragraphs,
        speaker_turns=_speaker_turns_for_transcription(paragraphs),
    )


def _paragraphs_from_storage(items: list[Any]) -> list[ASRParagraph]:
    return [ASRParagraph.model_validate(item) for item in items]


def _asr_document_from_cached_record(
    document_id: uuid.UUID, record: Any
) -> ASRDocument:
    validation = record.validation or []
    if validation:
        paragraphs = _paragraphs_from_storage(validation)
        return ASRDocument(
            document_id=document_id,
            title=record.name,
            document=paragraphs,
            speaker_turns=_speaker_turns_for_validation(paragraphs),
        )

    paragraphs = _paragraphs_from_storage(record.transcription)
    return _asr_document_from_transcription(document_id, paragraphs, title=record.name)


def _build_sse_message(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def get_transcribe_base_url() -> str:
    base_url = settings.TRANSCRIBE_BASE_URL
    if not base_url:
        raise ConfigurationError(detail="TRANSCRIBE_BASE_URL is not configured")
    return base_url


async def _transcribe_audio_bytes_with_error_handling(
    data: bytes,
    filename: str,
    content_type: str,
) -> list[ASRParagraph]:
    try:
        segments = await transcribe_audio_bytes(data, filename, content_type)
    except RuntimeError as exc:
        raise UpstreamServiceError(detail=str(exc)) from exc
    except Exception as exc:
        raise AymuraiAPIException(
            status_code=500, detail="Unexpected error during transcription"
        ) from exc

    return _segments_to_paragraphs(segments)


@router.post("/transcribe", response_model=ASRDocument)
async def transcribe(
    file: UploadFile,
    use_cache: bool = True,
    base_url: str = Depends(get_transcribe_base_url),
    session: Session = Depends(get_session),
) -> ASRDocument:
    data = await file.read()
    document_id = data_to_uuid(data)

    if use_cache:
        cached_record = audio_transcription_get(
            transcription_id=document_id, session=session
        )
        if cached_record is not None:
            logger.debug("Audio transcription DB hit for %s", file.filename)
            return _asr_document_from_cached_record(document_id, cached_record)

    transcription_items = await _transcribe_audio_bytes_with_error_handling(
        data,
        file.filename or str(document_id),
        file.content_type or "application/octet-stream",
    )
    title = file.filename or str(document_id)
    document = _asr_document_from_transcription(
        document_id, transcription_items, title=title
    )
    audio_transcription_create_or_update(
        transcription_id=document_id,
        name=title,
        transcription=document.document,
        session=session,
    )
    logger.debug("Audio transcription stored in DB for %s", file.filename)

    return document


@router.post("/transcribe/stream")
async def transcribe_stream(
    file: UploadFile,
    use_cache: bool = True,
    base_url: str = Depends(get_transcribe_base_url),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    data = await file.read()
    document_id = data_to_uuid(data)
    filename = file.filename or str(document_id)
    content_type = file.content_type or "application/octet-stream"

    cached_document: ASRDocument | None = None
    if use_cache:
        cached_record = audio_transcription_get(
            transcription_id=document_id, session=session
        )
        if cached_record is not None:
            cached_document = _asr_document_from_cached_record(
                document_id, cached_record
            )

    duration = probe_audio_duration(data)

    async def event_stream() -> AsyncIterator[str]:
        yield _build_sse_message(
            {
                "type": "meta",
                "document_id": str(document_id),
                "title": cached_document.title
                if cached_document is not None
                else filename,
                "duration": duration,
            }
        )

        if cached_document is not None:
            yield _build_sse_message(
                {
                    "type": "segments",
                    "title": cached_document.title,
                    "document": [
                        paragraph.model_dump(mode="json")
                        for paragraph in cached_document.document
                    ],
                    "speaker_turns": [
                        turn.model_dump(mode="json")
                        for turn in cached_document.speaker_turns
                    ],
                }
            )
            yield _build_sse_message({"type": "done", "progress": 1.0})
            return

        cumulative_chars = 0
        try:
            async for event in stream_transcribe_audio_bytes(
                data, filename, content_type
            ):
                if isinstance(event, CoroStreamDelta):
                    cumulative_chars += len(event.text)
                    payload: dict[str, Any] = {"type": "delta", "text": event.text}
                    progress = _estimate_progress(cumulative_chars, duration)
                    if progress is not None:
                        payload["progress"] = progress
                    yield _build_sse_message(payload)
                elif isinstance(event, CoroStreamSegments):
                    paragraphs = _segments_to_paragraphs(event.segments)
                    audio_transcription_create_or_update(
                        transcription_id=document_id,
                        name=filename,
                        transcription=paragraphs,
                        session=session,
                    )
                    yield _build_sse_message(
                        {
                            "type": "segments",
                            "title": filename,
                            "document": [
                                paragraph.model_dump(mode="json")
                                for paragraph in paragraphs
                            ],
                            "speaker_turns": [
                                turn.model_dump(mode="json")
                                for turn in _speaker_turns_for_transcription(paragraphs)
                            ],
                        }
                    )
        except RuntimeError as exc:
            logger.error("asr stream error: %s", exc)
            yield _build_sse_message({"type": "error", "detail": str(exc)})
            return

        yield _build_sse_message({"type": "done", "progress": 1.0})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/validation/document/{document_id}")
async def asr_read_document_validation(
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> ASRDocument | None:
    record = audio_transcription_get(transcription_id=document_id, session=session)
    if not record:
        raise NotFoundError(detail=f"Document not found: {document_id}")

    return _asr_document_from_cached_record(document_id, record)


@router.post("/validation/document/{document_id}")
async def asr_save_document_validation(
    document_id: uuid.UUID,
    payload: list[ASRParagraphRequest] | ASRValidationDocumentRequest = Body(...),
    session: Session = Depends(get_session),
) -> None:
    record = audio_transcription_get(transcription_id=document_id, session=session)
    if not record:
        raise NotFoundError(detail=f"Document not found: {document_id}")

    if isinstance(payload, ASRValidationDocumentRequest):
        annotations = payload.document
        if payload.title is not None:
            record.name = payload.title
    else:
        annotations = payload

    record.validation = [  # type: ignore
        ASRParagraph.model_validate(item).model_dump(mode="json")
        for item in annotations
    ]

    session.add(record)
    session.commit()
    session.refresh(record)
