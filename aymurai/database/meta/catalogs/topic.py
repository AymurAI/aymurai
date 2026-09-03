import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, func, text
from sqlmodel import Field, SQLModel


class TopicBase(SQLModel):
    # `code` is the Defensoría's own `area` code (e.g. "ACC") -- nullable because a
    # topic created from the app doesn't have an official code yet.
    code: str | None = Field(None, unique=True, index=True)
    name: str
    active: bool = True
    order: int = 0


class Topic(TopicBase, table=True):
    __tablename__ = "topic"
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        sa_column=Column(DateTime(), onupdate=func.now())
    )


class TopicCreate(TopicBase):
    pass


class TopicUpdate(SQLModel):
    code: str | None = None
    name: str | None = None
    active: bool | None = None
    order: int | None = None


class TopicRead(TopicBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
