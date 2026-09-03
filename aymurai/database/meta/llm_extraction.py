import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, DateTime, func, text
from sqlmodel import Field, SQLModel


class LLMExtractionBase(SQLModel):
    file_name: str | None = None
    source_text: str
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
    prediction: dict[str, Any] | None = None
    config: dict[str, Any] | None = None


class LLMExtractionRead(LLMExtractionBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
