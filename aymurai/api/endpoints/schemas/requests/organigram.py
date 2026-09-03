import uuid

from pydantic import BaseModel, ConfigDict


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


class OrganigramHolderUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
