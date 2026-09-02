import uuid
from datetime import datetime

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
    is_current: bool
    created_at: datetime
    updated_at: datetime | None
