import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, func, text
from sqlmodel import Field, SQLModel


class DatasetBase(SQLModel):
    code: str = Field(unique=True, index=True)
    name: str


class Dataset(DatasetBase, table=True):
    __tablename__ = "dataset"
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        sa_column=Column(DateTime(), onupdate=func.now())
    )


class DatasetCreate(DatasetBase):
    pass


class DatasetRead(DatasetBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
