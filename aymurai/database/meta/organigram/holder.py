import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Column, DateTime, Index, func, text
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from aymurai.database.meta.organigram.unit import OrganigramUnit


class OrganigramHolderBase(SQLModel):
    unit_id: uuid.UUID = Field(foreign_key="organigram_unit.id")
    name: str
    # When this person took office, which is not when the row was written:
    # seeding an existing organigram in 2026 records terms that began years
    # earlier, and a real history needs the term date, not the insert date.
    # `created_at` stays what it has always been -- an audit timestamp.
    # Nullable because rows predating this column have no term date to claim.
    start_date: date | None = None
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
    start_date: date | None = None


class OrganigramHolderRead(OrganigramHolderBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
