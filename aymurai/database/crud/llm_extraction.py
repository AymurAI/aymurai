import uuid
from typing import Any

from sqlalchemy import update
from sqlmodel import Session, col

from aymurai.database.schema import LLMExtraction


def llm_extraction_get(
    extraction_id: uuid.UUID, session: Session
) -> LLMExtraction | None:
    """
    Get an extraction record by ID.

    Args:
        extraction_id (uuid.UUID): ID of the extraction record.
        session (Session): SQLAlchemy session.

    Returns:
        LLMExtraction | None: Extraction record if found, else None.
    """
    return session.get(LLMExtraction, extraction_id)


def llm_extraction_create_or_update(
    extraction_id: uuid.UUID,
    file_name: str | None,
    source_text: str,
    prediction: dict[str, Any],
    config: dict[str, Any],
    session: Session,
    *,
    source_paragraphs: list[str] | None = None,
) -> LLMExtraction:
    """
    Create or update an extraction record.

    Args:
        extraction_id (uuid.UUID): ID of the extraction record.
        file_name (str | None): Original file name, if known. When updating an existing
            record, None is treated as "caller doesn't know the file name", not as a signal
            to clear it — the schema has no way to express "remove the file name", and
            no caller needs to. Thus None only ever means "preserve the existing value".
        source_text (str): Document text the extraction ran against.
        prediction (dict[str, Any]): Raw model output, verbatim.
        config (dict[str, Any]): Generation config used for this run.
        session (Session): SQLAlchemy session.
        source_paragraphs (list[str] | None): The paragraphs `source_text` was
            joined from. Replaced together with `source_text` on update, since
            the two describe the same run.

    Returns:
        LLMExtraction: The created or updated extraction record.
    """
    record = session.get(LLMExtraction, extraction_id)

    if not record:
        record = LLMExtraction(
            id=extraction_id,
            file_name=file_name,
            source_text=source_text,
            source_paragraphs=source_paragraphs,
            prediction=prediction,
            config=config,
        )
    else:
        if file_name is not None:
            record.file_name = file_name
        record.source_text = source_text
        record.source_paragraphs = source_paragraphs
        record.prediction = prediction
        record.config = config

    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def llm_extraction_backfill_paragraphs(
    record: LLMExtraction, paragraphs: list[str], session: Session
) -> LLMExtraction:
    """
    Gives a legacy extraction back the paragraphs its `source_text` came from.

    Rows extracted before `source_paragraphs` was stored only have their
    `"\\n".join`, which can't be split back. When the same document arrives
    again and its paragraphs join to exactly the stored text, they are the
    paragraphs that text was built from, so they are kept. Anything else --
    paragraphs already stored, or a text that differs -- leaves the row alone.

    Written with a Core UPDATE that pins `updated_at` to itself: this is the
    same extraction, not a new run, so its timestamp must not move.

    Args:
        record (LLMExtraction): The stored extraction (a cache hit).
        paragraphs (list[str]): The paragraphs of the incoming request.
        session (Session): SQLAlchemy session.

    Returns:
        LLMExtraction: The record, refreshed if it was backfilled.
    """
    if record.source_paragraphs is not None:
        return record
    if "\n".join(paragraphs) != record.source_text:
        return record

    session.execute(
        update(LLMExtraction)
        .where(col(LLMExtraction.id) == record.id)
        .values(source_paragraphs=list(paragraphs), updated_at=LLMExtraction.updated_at)
    )
    session.commit()
    session.refresh(record)
    return record
