import uuid
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, func, text
from sqlmodel import Field, SQLModel


class SummarizationBase(SQLModel):
    """
    Shared columns for a persisted document summarization.

    Note:
        The `summary` / `validation` type asymmetry is deliberate. `summary` is
        the LLM's markdown output; `validation` is the frontend editor's TipTap
        `JSONContent` document. They are different artifacts and must not be
        coerced to a single type.
    """

    title: str | None = Field(default=None)
    text: str = Field(nullable=False)
    summary: str = Field(nullable=False)
    validation: dict | None = Field(default=None, sa_column=Column(JSON))
    config: dict = Field(sa_column=Column(JSON))
    steps: list[dict] = Field(sa_column=Column(JSON))
    chunks_used: int


class Summarization(SummarizationBase, table=True):
    """A summarization row, keyed by `text_to_uuid` of the source document text."""

    __tablename__ = "llm_summarization"  # type: ignore[bad-override]
    id: uuid.UUID | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(), onupdate=func.now())
    )


class SummarizationCreate(SummarizationBase):
    pass


class SummarizationUpdate(SQLModel):
    title: str | None = None
    text: str | None = None
    summary: str | None = None
    validation: dict | None = None
    config: dict | None = None
    steps: list[dict] | None = None
    chunks_used: int | None = None


class SummarizationRead(SummarizationBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
