import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Column, DateTime, UniqueConstraint, func, text
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
    # Mirrors migration dd89f40c7c3e. Declared here as well so that
    # SQLModel.metadata.create_all (which every test uses) enforces it --
    # otherwise the suite cannot catch a violation the real database would.
    # On the table class only: the non-table subclasses must not carry it.
    __table_args__ = (
        UniqueConstraint("topic_id", "name", name="uq_subtopic_topic_id_name"),
    )
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
