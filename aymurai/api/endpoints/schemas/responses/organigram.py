import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class OrganigramUnitResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    acronym: str | None
    short_name: str | None
    is_sector: bool
    active: bool
    order: int | None
    created_at: datetime
    updated_at: datetime | None


class OrganigramHolderResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    unit_id: uuid.UUID
    name: str
    # When the term began. `created_at` stays alongside it as the audit
    # timestamp -- the two differ whenever a history is entered after the fact.
    start_date: date | None
    is_current: bool
    created_at: datetime
    updated_at: datetime | None
