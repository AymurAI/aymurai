import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, func, text
from sqlmodel import Field, Relationship, SQLModel


class OrganigramUnitBase(SQLModel):
    name: str
    acronym: str | None = None
    # Short display label for when `name` is long/formal, e.g. "AGIP".
    short_name: str | None = None
    # The sector of a unit is the deepest ancestor-or-self with is_sector=True.
    is_sector: bool = False
    active: bool = True
    order: int | None = None


class OrganigramUnit(OrganigramUnitBase, table=True):
    __tablename__ = "organigram_unit"
    # Assigned explicitly by the seed as uuid5(NS, "<ruta_cargos>#<index>"),
    # never recomputed afterwards -- it's derived from a mutable value, so
    # recomputing it after a rename would break every existing reference.
    id: uuid.UUID | None = Field(None, primary_key=True)
    parent_id: uuid.UUID | None = Field(None, foreign_key="organigram_unit.id")
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        sa_column=Column(DateTime(), onupdate=func.now())
    )

    parent: "OrganigramUnit" = Relationship(
        back_populates="children",
        sa_relationship_kwargs={"remote_side": "OrganigramUnit.id"},
    )
    children: list["OrganigramUnit"] = Relationship(back_populates="parent")


class OrganigramUnitCreate(OrganigramUnitBase):
    parent_id: uuid.UUID | None = None


class OrganigramUnitUpdate(SQLModel):
    name: str | None = None
    acronym: str | None = None
    short_name: str | None = None
    is_sector: bool | None = None
    active: bool | None = None
    order: int | None = None


class OrganigramUnitRead(OrganigramUnitBase):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime | None = None
