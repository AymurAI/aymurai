import uuid

from pydantic import BaseModel, ConfigDict


class TopicCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str | None = None
    name: str
    order: int = 0


class TopicUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str | None = None
    name: str | None = None
    active: bool | None = None
    order: int | None = None


class SubtopicCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic_id: uuid.UUID
    code: str | None = None
    name: str
    order: int = 0


class SubtopicUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str | None = None
    name: str | None = None
    active: bool | None = None
    order: int | None = None


class SubtopicReassignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_subtopic_id: uuid.UUID


class MacroSectorUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    active: bool | None = None
    order: int | None = None
