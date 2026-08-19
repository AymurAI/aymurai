import uuid
from typing import Any

from sqlmodel import Session

from aymurai.database.schema import Summarization


def summarization_get(
    summarization_id: uuid.UUID,
    session: Session,
) -> Summarization | None:
    """
    Get a summarization record by ID.

    Args:
        summarization_id (uuid.UUID): ID of the summarization record.
        session (Session): SQLAlchemy session.

    Returns:
        Summarization | None: Summarization record if found, else None.
    """
    return session.get(Summarization, summarization_id)


def summarization_create_or_update(
    summarization_id: uuid.UUID,
    text: str,
    summary: str,
    config: dict[str, Any],
    steps: list[dict[str, Any]],
    chunks_used: int,
    session: Session,
    title: str | None = None,
) -> Summarization:
    """
    Create or update a summarization record.

    Regenerating a summary supersedes whatever was validated against the previous
    prediction, so `validation` is always reset to None here — mirroring
    `audio_transcription_create_or_update`.

    Args:
        summarization_id (uuid.UUID): ID of the summarization record.
        text (str): Source document text that was summarized.
        summary (str): LLM-generated summary, in markdown.
        config (dict[str, Any]): Generation config used for this run.
        steps (list[dict[str, Any]]): Per-chunk summarization step metadata.
        chunks_used (int): Number of chunks processed for this run.
        session (Session): SQLAlchemy session.
        title (str | None, optional): User-facing summary title. Defaults to None.

    Returns:
        Summarization: The created or updated Summarization record.
    """
    record = session.get(Summarization, summarization_id)

    if not record:
        record = Summarization(
            id=summarization_id,
            title=title,
            text=text,
            summary=summary,
            validation=None,
            config=config,
            steps=steps,
            chunks_used=chunks_used,
        )
    else:
        if title is not None:
            record.title = title
        record.text = text
        record.summary = summary
        record.validation = None
        record.config = config
        record.steps = steps
        record.chunks_used = chunks_used

    session.add(record)
    session.commit()
    session.refresh(record)
    return record
