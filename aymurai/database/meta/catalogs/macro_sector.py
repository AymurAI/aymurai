import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, func, text
from sqlmodel import Field, SQLModel


class MacroSectorBase(SQLModel):
    # `code` (GCBA | ORGANISMOS_NACIONALES | OBRA_SOCIAL_PREPAGA | EMPRESA) is what
    # gates behavior (the organigram cross-check only fires for "GCBA"). `name` is
    # a freely editable label and must never be used in logic.
    code: str = Field(unique=True, index=True)
    name: str
    active: bool = True
    order: int = 0


class MacroSector(MacroSectorBase, table=True):
    __tablename__ = "macro_sector"
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        sa_column=Column(DateTime(), onupdate=func.now())
    )


class MacroSectorCreate(MacroSectorBase):
    pass


class MacroSectorUpdate(SQLModel):
    name: str | None = None
    active: bool | None = None
    order: int | None = None


class MacroSectorRead(MacroSectorBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
