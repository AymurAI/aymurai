from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import UUID5, BaseModel, ConfigDict, Field
from sqlmodel import Session

from aymurai.api.endpoints.routers.llm.summarization_engine import (
    DEFAULT_ENTITIES_TO_IDENTIFY,
    DEFAULT_INFORMATION_TO_EXTRACT,
    ContextBudget,
    ContextTooSmallError,
    DoneEvent,
    EmptyCompletionError,
    StepEvent,
    SummarizationConfig,
    SummarizationStep,
    TokenEvent,
    _build_sse_message,
    _load_template_prompt,
    load_rolling_prompt,
    prepare_run,
    summarize_events,
)
from aymurai.database.crud.summarization import (
    summarization_create_or_update,
    summarization_get,
)
from aymurai.database.schema import Summarization
from aymurai.database.session import get_session
from aymurai.database.utils import text_to_uuid
from aymurai.llm_providers import LlamaCppLLMProvider
from aymurai.logger import get_logger
from aymurai.settings import settings

logger = get_logger(__name__)

router = APIRouter()


class GenerationOptions(BaseModel):
    """OpenAI-native chat-completion parameters forwarded to llama.cpp.

    The context window is deliberately absent: it has no OpenAI equivalent and
    is fixed when `llama-server` launches, so the server's own `n_ctx` is
    authoritative (optionally capped by `settings.LLM_MAX_CONTEXT_TOKENS`).
    """

    model_config = ConfigDict(extra="forbid")

    max_tokens: int = Field(
        default_factory=lambda: settings.LLM_DEFAULT_MAX_TOKENS,
        gt=0,
        description="Maximum tokens to generate. Must also cover reasoning "
        "tokens when the server has thinking enabled.",
    )
    temperature: float | None = Field(default=None, ge=0.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    seed: int | None = None
    stop: list[str] | None = None


class SummarizationRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "text": "Texto de entrada a resumir.",
                "options": {"max_tokens": 4096},
            }
        },
    )

    text: str = Field(..., description="Raw document to summarize.")
    model: str | None = Field(
        default=None,
        description=(
            "Optional model override. Inert on a single-model llama-server, "
            "which ignores the field and serves whatever it was launched with; "
            "when omitted the served model's own id is reported back."
        ),
    )
    system_prompt: str | None = Field(
        default=None,
        description="Optional system prompt override. Defaults to the template in /resources/llm/summarization.yml.",
    )
    information_to_extract: str | None = Field(
        default=DEFAULT_INFORMATION_TO_EXTRACT,
        description="Template variable information_to_extract.",
    )
    entities_to_identify: str | None = Field(
        default=DEFAULT_ENTITIES_TO_IDENTIFY,
        description="Template variable entities_to_identify.",
    )
    options: GenerationOptions = Field(default_factory=GenerationOptions)


class SummarizationResponse(BaseModel):
    document_id: UUID5
    summary: str
    model: str
    system_prompt: str
    options: dict[str, Any]
    chunks_used: int
    steps: list[SummarizationStep]
    config: SummarizationConfig


def _response_from_record(record: Summarization) -> SummarizationResponse:
    """
    Build a summarize response from a persisted summarization record.

    Args:
        record (Summarization): The stored summarization row.

    Returns:
        SummarizationResponse: The response, with the stored generation config
            echoed in both the flat legacy fields and the `config` object.
    """
    config = SummarizationConfig.model_validate(record.config)
    return SummarizationResponse(
        document_id=record.id,
        summary=record.summary,
        model=config.model,
        system_prompt=config.system_prompt,
        options=config.options,
        chunks_used=record.chunks_used,
        steps=[SummarizationStep.model_validate(step) for step in record.steps],
        config=config,
    )


@router.post("/summarize", response_model=SummarizationResponse)
async def summarize_document(
    payload: SummarizationRequest,
    session: Annotated[Session, Depends(get_session)],
    use_cache: bool = True,
) -> SummarizationResponse:
    """
    Summarize a document using the configured LLM provider, persisting the result.

    Chunks inputs above the context limit and performs a rolling summarization
    that keeps the interim summary in context for subsequent chunks. The result
    is stored in `llm_summarization`, keyed by `text_to_uuid(text)`.

    Cache identity is the source text alone — the request's generation config is
    never compared against the stored one. Regeneration therefore requires an
    explicit `use_cache=false`, and clears any stored human validation.

    Args:
        payload (SummarizationRequest): The summarization request body.
        session (Session, optional): The database session. Defaults to
            Depends(get_session).
        use_cache (bool, optional): Whether to return a stored summary when one
            exists for this text. Defaults to True.

    Raises:
        HTTPException: If the input text is empty.

    Returns:
        SummarizationResponse: The summary, its document id and its config.
    """
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Input text cannot be empty.")

    document_id = text_to_uuid(payload.text)

    if use_cache:
        cached_record = summarization_get(summarization_id=document_id, session=session)
        if cached_record is not None:
            logger.debug("Summarization DB hit for %s", document_id)
            return _response_from_record(cached_record)

    system_prompt = payload.system_prompt or _load_template_prompt(
        information_to_extract=payload.information_to_extract,
        entities_to_identify=payload.entities_to_identify,
    )
    options = payload.options
    rolling_system_prompt = load_rolling_prompt(
        information_to_extract=payload.information_to_extract,
        entities_to_identify=payload.entities_to_identify,
    )

    try:
        provider, budget = await prepare_run(
            payload.model,
            system_prompt=system_prompt,
            rolling_system_prompt=rolling_system_prompt,
            max_tokens=options.max_tokens,
        )
    except ContextTooSmallError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    summary, steps, chunk_count = "", [], 0
    try:
        async for event in summarize_events(
            provider,
            text=payload.text,
            budget=budget,
            options=options.model_dump(exclude_none=True),
            system_prompt=system_prompt,
            rolling_system_prompt=rolling_system_prompt,
        ):
            if isinstance(event, StepEvent):
                steps.append(event.step)
            elif isinstance(event, DoneEvent):
                summary, chunk_count = event.summary, event.chunks_used
    except (ContextTooSmallError, EmptyCompletionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await provider.aclose()

    config = SummarizationConfig(
        model=provider.model_name,
        system_prompt=system_prompt,
        options=options.model_dump(exclude_none=True),
    )
    record = summarization_create_or_update(
        summarization_id=document_id,
        text=payload.text,
        summary=summary,
        config=config.model_dump(mode="json"),
        steps=[step.model_dump(mode="json") for step in steps],
        chunks_used=chunk_count or 1,
        session=session,
    )
    logger.debug("Summarization stored in DB for %s", document_id)

    return _response_from_record(record)


def _cache_hit_events(record: Summarization) -> list[str]:
    """
    Build the SSE frames for a stream cache hit.

    Emits the stored summary as-is — meta, a single full-text token, then the
    terminal summary event — without calling the provider or writing to the
    database. Crucially it does NOT regenerate, so the stored human `validation`
    is left intact, mirroring how `/asr/transcribe/stream` replays a cached
    record instead of re-transcribing.

    Args:
        record (Summarization): The stored summarization row.

    Returns:
        list[str]: The SSE `data:` frames to stream for the cache hit.
    """
    config = SummarizationConfig.model_validate(record.config)
    steps = [
        SummarizationStep.model_validate(step).model_dump(mode="json")
        for step in record.steps
    ]

    frames = [
        _build_sse_message(
            {
                "type": "meta",
                "document_id": str(record.id),
                "model": config.model,
                "system_prompt": config.system_prompt,
                "options": config.options,
            }
        )
    ]
    if record.summary:
        frames.append(
            _build_sse_message(
                {
                    "type": "token",
                    "chunk_index": 0,
                    "source": "cache",
                    "text": record.summary,
                }
            )
        )
    frames.append(
        _build_sse_message(
            {
                "type": "summary",
                "summary": record.summary,
                "chunks_used": record.chunks_used,
                "steps": steps,
                "model": config.model,
            }
        )
    )
    return frames


async def _stream_summary_events(
    provider: LlamaCppLLMProvider,
    *,
    payload: SummarizationRequest,
    options: GenerationOptions,
    budget: ContextBudget,
    system_prompt: str,
    rolling_system_prompt: str,
    document_id: uuid.UUID,
    cached_record: Summarization | None,
    session: Session,
) -> AsyncIterator[str]:
    """
    Yield SSE-formatted summarization events for a single request.

    On a cache hit, replays the stored summary without ever touching
    `provider`. Otherwise generates, streams tokens, and persists the result
    on the terminal `summary` event.

    Args:
        provider: A resolved llama.cpp provider.
        payload: The incoming summarization request.
        options: Generation options forwarded to the model.
        budget: The measured context budget from `prepare_run`.
        system_prompt: System prompt for the first window.
        rolling_system_prompt: System prompt for follow-up windows.
        document_id: The `text_to_uuid(payload.text)` identity for this request.
        cached_record: A stored summarization row, if `use_cache` found a hit.
        session: The database session used to persist a freshly generated summary.

    Yields:
        AsyncIterator[str]: SSE `data: ...` messages (`meta`, `token`, `summary`).
    """
    if cached_record is not None:
        logger.debug("Summarization stream cache hit for %s", document_id)
        for frame in _cache_hit_events(cached_record):
            yield frame
        return

    reported_options = options.model_dump(exclude_none=True)

    yield _build_sse_message(
        {
            "type": "meta",
            "document_id": str(document_id),
            "model": provider.model_name,
            "system_prompt": system_prompt,
            "options": reported_options,
        }
    )

    steps: list[dict[str, Any]] = []
    summary = ""
    chunks_used = 0

    try:
        async for event in summarize_events(
            provider,
            text=payload.text,
            budget=budget,
            options=reported_options,
            system_prompt=system_prompt,
            rolling_system_prompt=rolling_system_prompt,
        ):
            if isinstance(event, TokenEvent):
                yield _build_sse_message(
                    {
                        "type": "token",
                        "chunk_index": event.chunk_index,
                        "source": event.source,
                        "text": event.text,
                    }
                )
            elif isinstance(event, StepEvent):
                steps.append(event.step.model_dump(mode="json"))
            elif isinstance(event, DoneEvent):
                summary, chunks_used = event.summary, event.chunks_used
    except EmptyCompletionError as exc:
        logger.warning(f"summarization stream aborted: {exc}")
        yield _build_sse_message({"type": "error", "message": str(exc)})
        return

    config = SummarizationConfig(
        model=provider.model_name,
        system_prompt=system_prompt,
        options=reported_options,
    )
    summarization_create_or_update(
        summarization_id=document_id,
        text=payload.text,
        summary=summary,
        config=config.model_dump(mode="json"),
        steps=steps,
        chunks_used=chunks_used,
        session=session,
    )
    logger.debug("Summarization stored in DB (stream) for %s", document_id)

    yield _build_sse_message(
        {
            "type": "summary",
            "summary": summary,
            "chunks_used": chunks_used,
            "steps": steps,
            "model": provider.model_name,
        }
    )


@router.post("/summarize/stream")
async def stream_summarize_document(
    payload: SummarizationRequest,
    session: Annotated[Session, Depends(get_session)],
    use_cache: bool = True,
) -> StreamingResponse:
    """Stream a document summary using server-sent events (text/event-stream).

    On a cache hit (a stored summary exists for this text and `use_cache` is
    true) it replays the stored summary without calling the provider or writing
    to the database — mirroring `/asr/transcribe/stream`, and leaving any stored
    human `validation` intact. Otherwise it generates, streams tokens, and
    persists the result on the terminal `summary` event (which clears the
    validation). The `meta` event carries `document_id` from the first frame.

    Emits:
        - data: {"type": "meta", "document_id": str, "model": str, "system_prompt": str, "options": {...}}
        - data: {"type": "token", "chunk_index": int, "source": str, "text": str}
        - data: {"type": "summary", "summary": str, "chunks_used": int, "steps": [...], "model": str}

    Args:
        payload (SummarizationRequest): The summarization request body.
        session (Session, optional): The database session. Defaults to
            Depends(get_session).
        use_cache (bool, optional): Whether to replay a stored summary when one
            exists for this text. Defaults to True.

    Raises:
        HTTPException: If the input text is empty.

    Returns:
        StreamingResponse: A text/event-stream of summarization progress events.
    """
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Input text cannot be empty.")

    document_id = text_to_uuid(payload.text)

    cached_record = (
        summarization_get(summarization_id=document_id, session=session)
        if use_cache
        else None
    )

    system_prompt = payload.system_prompt or _load_template_prompt(
        information_to_extract=payload.information_to_extract,
        entities_to_identify=payload.entities_to_identify,
    )
    options = payload.options
    rolling_system_prompt = load_rolling_prompt(
        information_to_extract=payload.information_to_extract,
        entities_to_identify=payload.entities_to_identify,
    )

    try:
        provider, budget = await prepare_run(
            payload.model,
            system_prompt=system_prompt,
            rolling_system_prompt=rolling_system_prompt,
            max_tokens=options.max_tokens,
        )
    except ContextTooSmallError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for message in _stream_summary_events(
                provider,
                payload=payload,
                options=options,
                budget=budget,
                system_prompt=system_prompt,
                rolling_system_prompt=rolling_system_prompt,
                document_id=document_id,
                cached_record=cached_record,
                session=session,
            ):
                yield message
        finally:
            await provider.aclose()

    return StreamingResponse(event_stream(), media_type="text/event-stream")
