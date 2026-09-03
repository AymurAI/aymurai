import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Column, DateTime, Index, func, text
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from aymurai.database.meta.organigram.unit import OrganigramUnit


class OrganigramHolderBase(SQLModel):
    unit_id: uuid.UUID = Field(foreign_key="organigram_unit.id")
    name: str
    # A curated flag, not "the most recent row": fixing a typo in a past
    # holder must never make it current again. Enforced by a partial unique
    # index on (unit_id) WHERE is_current -- see the migration.
    is_current: bool = False


class OrganigramHolder(OrganigramHolderBase, table=True):
    __tablename__ = "organigram_holder"
    __table_args__ = (
        # Mirrors the migration's partial unique index -- SQLModel.metadata
        # (used directly by tests) doesn't see indexes declared only in an
        # Alembic revision, so it has to live here too.
        Index(
            "uq_organigram_holder_unit_id_current",
            "unit_id",
            unique=True,
            sqlite_where=text("is_current = 1"),
        ),
    )
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        sa_column=Column(DateTime(), onupdate=func.now())
    )

    unit: "OrganigramUnit" = Relationship()


class OrganigramHolderCreate(OrganigramHolderBase):
    pass


class OrganigramHolderUpdate(SQLModel):
    name: str | None = None


class OrganigramHolderRead(OrganigramHolderBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
