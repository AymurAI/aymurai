import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, model_validator


class OrganigramUnitCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parent_id: uuid.UUID | None = None
    name: str
    acronym: str | None = None
    short_name: str | None = None
    is_sector: bool = False
    order: int | None = None


class OrganigramUnitUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    acronym: str | None = None
    short_name: str | None = None
    is_sector: bool | None = None
    active: bool | None = None
    order: int | None = None


class OrganigramHolderCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    # Omitted means "took office today", which is the appointment case. A term
    # that began earlier -- the usual case when entering a real history -- says
    # so explicitly.
    start_date: date | None = None


class OrganigramHolderUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    start_date: date | None = None

    @model_validator(mode="after")
    def _require_a_correction(self) -> "OrganigramHolderUpdateRequest":
        """A PATCH that corrects nothing is a client mistake, not a no-op to
        answer 200 to -- and with both fields optional it is now expressible."""
        if self.name is None and self.start_date is None:
            raise ValueError("Provide at least one of: name, start_date")
        return self
