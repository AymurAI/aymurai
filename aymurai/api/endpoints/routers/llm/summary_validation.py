"""Human-validation routes for stored document summaries.

Separate from `summarization.py` (the generation routes) so each router module
stays a thin orchestration layer well inside the CES-71 size limit. Both are
registered under the same `/llm` prefix.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pydantic import UUID5, BaseModel
from sqlmodel import Session

from aymurai.api.endpoints.routers.llm.summarization_engine import (
    SummarizationConfig,
    SummarizationStep,
)
from aymurai.api.exceptions import NotFoundError
from aymurai.database.crud.summarization import summarization_get
from aymurai.database.schema import Summarization
from aymurai.database.session import get_session
from aymurai.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


class SummarizationValidationRequest(BaseModel):
    """The payload the editor sends when saving a human-validated summary."""

    title: str | None = None
    validation: dict[str, Any]


class SummarizationValidationResponse(BaseModel):
    """A stored summarization, returned with the machine and human artifacts side by side.

    Note:
        `summary` (markdown) and `validation` (TipTap JSONContent) are both
        returned. They are deliberately NOT collapsed into a single field the way
        `ASRDocument.from_transcription` collapses to `validation or transcription`
        — the client picks (`response.validation ?? documentFromMarkdown(response.summary)`).
    """

    document_id: UUID5
    title: str | None = None
    text: str
    summary: str
    validation: dict[str, Any] | None = None
    chunks_used: int
    steps: list[SummarizationStep]
    config: SummarizationConfig


def _validation_response_from_record(
    record: Summarization,
) -> SummarizationValidationResponse:
    """
    Build a validation response from a persisted summarization record.

    Args:
        record (Summarization): The stored summarization row.

    Returns:
        SummarizationValidationResponse: The record, with `summary` and
            `validation` both present and unmodified.
    """
    return SummarizationValidationResponse(
        document_id=record.id,
        title=record.title,
        text=record.text,
        summary=record.summary,
        validation=record.validation,
        chunks_used=record.chunks_used,
        steps=[SummarizationStep.model_validate(step) for step in record.steps],
        config=SummarizationConfig.model_validate(record.config),
    )


@router.get("/summarize/validation/document/{document_id}")
async def summarization_read_document_validation(
    document_id: UUID5,
    session: Annotated[Session, Depends(get_session)],
) -> SummarizationValidationResponse:
    """
    Retrieve the stored summarization record for a given document ID.

    Returns both the machine-generated `summary` (markdown) and the human
    `validation` (TipTap JSONContent, null when never validated). The caller
    chooses which to render.

    Args:
        document_id (UUID5): The content-derived ID of the summarized document.
        session (Session, optional): The database session. Defaults to
            Depends(get_session).

    Raises:
        NotFoundError: If no summarization exists for the given ID.

    Returns:
        SummarizationValidationResponse: The stored summarization record.
    """
    record = summarization_get(summarization_id=document_id, session=session)
    if not record:
        raise NotFoundError(detail=f"Document not found: {document_id}")

    return _validation_response_from_record(record)


@router.post("/summarize/validation/document/{document_id}")
async def summarization_save_document_validation(
    document_id: UUID5,
    payload: Annotated[SummarizationValidationRequest, Body()],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """
    Save the human-validated summary for a given document ID.

    Stores the editor's TipTap JSONContent document verbatim. The
    machine-generated `summary` column is never touched here.

    Args:
        document_id (UUID5): The content-derived ID of the summarized document.
        payload (SummarizationValidationRequest): The title and validation
            document to store. A null title leaves the stored title untouched.
        session (Session, optional): The database session. Defaults to
            Depends(get_session).

    Raises:
        NotFoundError: If no summarization exists for the given ID.
    """
    record = summarization_get(summarization_id=document_id, session=session)
    if not record:
        raise NotFoundError(detail=f"Document not found: {document_id}")

    if payload.title is not None:
        record.title = payload.title
    record.validation = payload.validation  # type: ignore[assignment]

    session.add(record)
    session.commit()
    session.refresh(record)
