import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TopicResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    code: str | None
    name: str
    active: bool
    order: int
    created_at: datetime
    updated_at: datetime | None


class SubtopicResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    topic_id: uuid.UUID
    code: str | None
    name: str
    active: bool
    order: int
    created_at: datetime
    updated_at: datetime | None


class MacroSectorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    code: str
    name: str
    active: bool
    order: int
    created_at: datetime
    updated_at: datetime | None


class UsageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    count: int


class ReassignResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reassigned: int


class RecommendationEnumsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    situations: list[str]
    statuses: list[str]
