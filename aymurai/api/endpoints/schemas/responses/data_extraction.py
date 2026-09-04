import uuid
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class OrganigramCandidateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID
    unit_name: str
    # The form posts `unit_id` and `sector_id` together: `_reconcile_recipients`
    # never derives one from the other (ADR-0009), and a request that omits
    # `sector_id` stores None, blanking SECTOR_FINAL in the export.
    sector_id: uuid.UUID | None = None
    sector_name: str | None = None
    ruta_organigrama: str
    score: float


class RecipientResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None
    position: str | None
    is_primary: bool
    macro_sector: str | None
    # Cross-referenced against the organigram, recomputed fresh on every
    # response (never persisted in `extraction.prediction`, which stays
    # verbatim LLM output) -- None when nothing cleared the match threshold.
    unit_id: uuid.UUID | None = None
    unit_name: str | None = None
    sector_id: uuid.UUID | None = None
    sector_name: str | None = None
    match_method: Literal["cargo", "name"] | None = None
    # Ranked alternatives regardless of whether `unit_id` cleared the match
    # threshold, for a human to pick from in `validate` when the
    # auto-resolved unit (or the lack of one) is wrong.
    sector_candidates: list[OrganigramCandidateResponse] = Field(default_factory=list)


class DataExtractionConfigResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str
    options: dict[str, Any]
    catalogs_hash: str


class DataExtractionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: uuid.UUID
    recommendation_number: str | None
    recommendation_date: str | None
    recipients: list[RecipientResponse]
    topic: str | None
    subtopic: str | None
    personal_data: bool | None
    publishable_content: str
    config: DataExtractionConfigResponse


class RecipientDetailResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    name: str | None
    position: str | None
    is_primary: bool
    macro_sector: str | None
    unit_id: uuid.UUID | None
    unit_name: str | None
    sector_id: uuid.UUID | None
    sector_name: str | None


class RecommendationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    document_id: uuid.UUID
    recommendation_number: str | None
    recommendation_date_text: str | None
    recommendation_date: date | None
    topic: str | None
    subtopic: str | None
    personal_data: bool | None
    publishable_content: str
    recipients: list[RecipientDetailResponse]


class RecommendationDetailResponse(RecommendationResponse):
    source_text: str
    prediction: dict[str, Any]


class RecommendationPageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[RecommendationResponse]
    total: int
    page: int
    page_size: int
