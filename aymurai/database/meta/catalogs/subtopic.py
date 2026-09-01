import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Column, DateTime, func, text
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from aymurai.database.meta.catalogs.topic import Topic


class SubtopicBase(SQLModel):
    topic_id: uuid.UUID = Field(foreign_key="topic.id")
    # `code` is the Defensoría's own `codigo` (e.g. "ACC20221") -- nullable for the
    # same reason as `Topic.code`.
    code: str | None = Field(None, unique=True, index=True)
    name: str
    active: bool = True
    order: int = 0


class Subtopic(SubtopicBase, table=True):
    __tablename__ = "subtopic"
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        sa_column=Column(DateTime(), onupdate=func.now())
    )

    topic: "Topic" = Relationship()


class SubtopicCreate(SubtopicBase):
    pass


class SubtopicUpdate(SQLModel):
    code: str | None = None
    name: str | None = None
    active: bool | None = None
    order: int | None = None


class SubtopicRead(SubtopicBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
