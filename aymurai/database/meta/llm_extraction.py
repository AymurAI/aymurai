import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, DateTime, func, text
from sqlmodel import Field, SQLModel


class LLMExtractionBase(SQLModel):
    file_name: str | None = None
    source_text: str
    # The paragraphs exactly as the extraction received them. `source_text`
    # is their `"\n".join`, which can't be split back when a paragraph has a
    # newline of its own; NULL on rows extracted before this was stored.
    source_paragraphs: list[str] | None = Field(default=None, sa_column=Column(JSON))
    prediction: dict[str, Any] = Field(sa_column=Column(JSON))
    config: dict[str, Any] = Field(sa_column=Column(JSON))


class LLMExtraction(LLMExtractionBase, table=True):
    __tablename__ = "llm_extraction"
    id: uuid.UUID | None = Field(None, primary_key=True)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        sa_column=Column(DateTime(), onupdate=func.now())
    )


class LLMExtractionCreate(LLMExtractionBase):
    pass


class LLMExtractionUpdate(SQLModel):
    file_name: str | None = None
    source_text: str | None = None
    source_paragraphs: list[str] | None = None
    prediction: dict[str, Any] | None = None
    config: dict[str, Any] | None = None


class LLMExtractionRead(LLMExtractionBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
