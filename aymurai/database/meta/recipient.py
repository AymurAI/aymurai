import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, func, text
from sqlmodel import Field, SQLModel


class RecipientBase(SQLModel):
    recommendation_id: uuid.UUID = Field(foreign_key="recommendation.id")
    order: int = 0
    raw_name: str | None = None
    raw_position: str | None = None
    # Feed the learned index (name/position -> unit), never shown as-is.
    normalized_name: str | None = Field(None, index=True)
    normalized_position: str | None = Field(None, index=True)
    is_primary: bool = False
    macro_sector_id: uuid.UUID | None = Field(None, foreign_key="macro_sector.id")
    unit_id: uuid.UUID | None = Field(None, foreign_key="organigram_unit.id")
    # Human-confirmed independently of `unit_id`, never derived from it --
    # denormalized on purpose, fixed at validation time and never recomputed
    # if the organigram reorganizes later.
    sector_id: uuid.UUID | None = Field(None, foreign_key="organigram_unit.id")
    # Which entry of `extraction.prediction.recipients` this row came from, so
    # the form can diff the frozen suggestion against the human's value without
    # re-pairing the two lists by array position -- the historical bug that
    # misattributed every later recipient as soon as an earlier one was deleted.
    # None when a person added the recipient by hand.
    source_index: int | None = None


class Recipient(RecipientBase, table=True):
    __tablename__ = "recipient"
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        sa_column=Column(DateTime(), onupdate=func.now())
    )


class RecipientCreate(RecipientBase):
    pass


class RecipientUpdate(SQLModel):
    order: int | None = None
    raw_name: str | None = None
    raw_position: str | None = None
    normalized_name: str | None = None
    normalized_position: str | None = None
    is_primary: bool | None = None
    macro_sector_id: uuid.UUID | None = None
    unit_id: uuid.UUID | None = None
    sector_id: uuid.UUID | None = None
    source_index: int | None = None


class RecipientRead(RecipientBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
