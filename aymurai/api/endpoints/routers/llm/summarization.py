from __future__ import annotations

from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import UUID5, BaseModel, ConfigDict, Field
from sqlmodel import Session

from aymurai.api.endpoints.routers.llm.summarization_engine import (
    DEFAULT_ENTITIES_TO_IDENTIFY,
    DEFAULT_INFORMATION_TO_EXTRACT,
    DEFAULT_MODEL,
    DEFAULT_OPTIONS,
    DEFAULT_TOKENIZER,
    SummarizationConfig,
    SummarizationStep,
    _build_provider,
    _build_sse_message,
    _load_template_prompt,
    _rolling_summarize,
    _trim_to_context,
)
from aymurai.database.crud.summarization import (
    summarization_create_or_update,
    summarization_get,
)
from aymurai.database.schema import Summarization
from aymurai.database.session import get_session
from aymurai.database.utils import text_to_uuid
from aymurai.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


class SummarizationRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "text": "Texto de entrada a resumir.",
                "model": DEFAULT_MODEL,
                "tokenizer": DEFAULT_TOKENIZER,
                "options": DEFAULT_OPTIONS,
            }
        }
    )

    text: str = Field(..., description="Raw document to summarize.")
    model: str = Field(
        default=DEFAULT_MODEL,
        description="Model name for Ollama. Defaults to gpt-oss:20b.",
    )
    tokenizer: str | None = Field(
        default=DEFAULT_TOKENIZER,
        description="Tokenizer name (tiktoken). Falls back to whitespace if unavailable.",
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
    options: dict[str, Any] = Field(
        default_factory=lambda: DEFAULT_OPTIONS.copy(),
        description="Ollama chat options. Defaults to num_ctx=16_384 and num_predict=4096.",
    )


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
    use_cache: bool = True,
    session: Session = Depends(get_session),
) -> SummarizationResponse:
    """
    Summarize a document using a local Ollama model, persisting the result.

    Chunks inputs above the context limit and performs a rolling summarization
    that keeps the interim summary in context for subsequent chunks. The result
    is stored in `llm_summarization`, keyed by `text_to_uuid(text)`.

    Cache identity is the source text alone — the request's generation config is
    never compared against the stored one. Regeneration therefore requires an
    explicit `use_cache=false`, and clears any stored human validation.

    Args:
        payload (SummarizationRequest): The summarization request body.
        use_cache (bool, optional): Whether to return a stored summary when one
            exists for this text. Defaults to True.
        session (Session, optional): The database session. Defaults to
            Depends(get_session).

    Raises:
        HTTPException: If the input text is empty or `num_ctx` is invalid.

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
    model_name = payload.model or DEFAULT_MODEL
    options = {**DEFAULT_OPTIONS, **(payload.options or {})}

    try:
        context_limit = int(options.get("num_ctx", DEFAULT_OPTIONS["num_ctx"]))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="num_ctx option must be an integer.",
        ) from exc

    if context_limit <= 0:
        raise HTTPException(status_code=400, detail="num_ctx must be greater than 0.")

    provider = _build_provider(
        model_name,
        tokenizer_name=payload.tokenizer,
        system_prompt=system_prompt,
        context_limit=context_limit,
    )

    summary, steps, chunk_count = await _rolling_summarize(
        provider,
        text=payload.text,
        options=options,
    )

    config = SummarizationConfig(
        model=provider.model_name,
        system_prompt=system_prompt,
        tokenizer=payload.tokenizer,
        options=options,
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


@router.post("/summarize/stream")
async def stream_summarize_document(
    payload: SummarizationRequest,
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Stream a document summary using server-sent events (text/event-stream).

    Persists the result on the terminal `summary` event, mirroring how
    `/asr/transcribe/stream` persists on its terminal segments event. The `meta`
    event carries `document_id` so the client has it from the first frame.

    Emits:
        - data: {"type": "meta", "document_id": str, "model": str, "system_prompt": str, "options": {...}}
        - data: {"type": "token", "chunk_index": int, "source": str, "text": str}
        - data: {"type": "summary", "summary": str, "chunks_used": int, "steps": [...], "model": str}

    Args:
        payload (SummarizationRequest): The summarization request body.
        session (Session, optional): The database session. Defaults to
            Depends(get_session).

    Raises:
        HTTPException: If the input text is empty or `num_ctx` is invalid.

    Returns:
        StreamingResponse: A text/event-stream of summarization progress events.
    """
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Input text cannot be empty.")

    system_prompt = payload.system_prompt or _load_template_prompt(
        information_to_extract=payload.information_to_extract,
        entities_to_identify=payload.entities_to_identify,
    )
    model_name = payload.model or DEFAULT_MODEL
    options = {**DEFAULT_OPTIONS, **(payload.options or {})}

    try:
        context_limit = int(options.get("num_ctx", DEFAULT_OPTIONS["num_ctx"]))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="num_ctx option must be an integer.",
        ) from exc

    if context_limit <= 0:
        raise HTTPException(status_code=400, detail="num_ctx must be greater than 0.")

    provider = _build_provider(
        model_name,
        tokenizer_name=payload.tokenizer,
        system_prompt=system_prompt,
        context_limit=context_limit,
    )

    document_id = text_to_uuid(payload.text)

    async def event_stream() -> AsyncIterator[str]:
        yield _build_sse_message(
            {
                "type": "meta",
                "document_id": str(document_id),
                "model": provider.model_name,
                "system_prompt": system_prompt,
                "options": options,
            }
        )

        chunks = provider.chunk_text(
            payload.text,
            max_tokens=provider.max_context_tokens,
        )

        if not chunks:
            yield _build_sse_message(
                {
                    "type": "summary",
                    "summary": "",
                    "chunks_used": 0,
                    "steps": [],
                    "model": provider.model_name,
                }
            )
            return

        steps: list[dict[str, Any]] = []
        summary = ""

        for chunk in chunks:
            source = "chunk" if not summary else "summary+chunk"
            combined_text = f"{summary}\n\n{chunk.text}" if summary else chunk.text
            combined_tokens = provider.count_tokens(combined_text)

            if (
                provider.max_context_tokens
                and combined_tokens > provider.max_context_tokens
                and summary
            ):
                chunk_summary = ""
                async for resp in provider.async_stream(
                    prompt=chunk.text,
                    options=options,
                ):
                    token = resp.text
                    if not token:
                        continue
                    chunk_summary += token
                    yield _build_sse_message(
                        {
                            "type": "token",
                            "chunk_index": chunk.index,
                            "source": "chunk",
                            "text": token,
                        }
                    )

                steps.append(
                    {
                        "chunk_index": chunk.index,
                        "input_tokens": chunk.token_count,
                        "source": "chunk",
                    }
                )

                combined_text = f"{summary}\n\n{chunk_summary}"
                combined_text = _trim_to_context(provider, combined_text)
                source = "summary+chunk"
                combined_tokens = provider.count_tokens(combined_text)

            updated_summary = ""
            async for resp in provider.async_stream(
                prompt=combined_text,
                options=options,
            ):
                token = resp.text
                if not token:
                    continue
                updated_summary += token
                yield _build_sse_message(
                    {
                        "type": "token",
                        "chunk_index": chunk.index,
                        "source": source,
                        "text": token,
                    }
                )

            steps.append(
                {
                    "chunk_index": chunk.index,
                    "input_tokens": combined_tokens,
                    "source": source,
                }
            )
            summary = updated_summary

        config = SummarizationConfig(
            model=provider.model_name,
            system_prompt=system_prompt,
            tokenizer=payload.tokenizer,
            options=options,
        )
        summarization_create_or_update(
            summarization_id=document_id,
            text=payload.text,
            summary=summary,
            config=config.model_dump(mode="json"),
            steps=steps,
            chunks_used=len(chunks),
            session=session,
        )
        logger.debug("Summarization stored in DB (stream) for %s", document_id)

        yield _build_sse_message(
            {
                "type": "summary",
                "summary": summary,
                "chunks_used": len(chunks),
                "steps": steps,
                "model": provider.model_name,
            }
        )

    return StreamingResponse(event_stream(), media_type="text/event-stream")
