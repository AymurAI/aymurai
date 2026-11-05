import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from aymurai.database.meta.recommendation import (
    RecommendationSituation,
    RecommendationStatus,
)


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
    # The specific unit whose match against the cargo text produced this
    # sector (the best-scoring one, if several collapsed into it) -- submit
    # both together in `validate` (`unit_id=source_unit_id`, `sector_id`
    # from this same candidate) and the consistency check in
    # `_reconcile_recipients` is guaranteed to pass, since that pairing is
    # exactly how the candidate was derived.
    source_unit_id: uuid.UUID | None = None
    source_unit_name: str | None = None


class OrganigramUnitCandidateResponse(BaseModel):
    """
    One ranked *unit* match, before the collapse to sectors that produces
    `OrganigramCandidateResponse`. Every field means what it says: `unit_id`
    is the unit, `sector_id` the sector containing it, `ruta_organigrama` the
    unit's own path. Posting `unit_id` with this row's `sector_id` always
    passes the consistency check, since the sector is `resolve_sector` of
    that same unit.
    """

    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID
    unit_name: str
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
    # The same ranking uncollapsed, and wider: once a human validates a
    # sector, the form narrows the unit field to that sector's units and
    # orders them by how well each matches the cargo. Only this side can
    # produce that order (hybrid embeddings + fuzzy), and collapsing to one
    # row per sector throws away everything such a filter needs.
    unit_candidates: list[OrganigramUnitCandidateResponse] = Field(default_factory=list)


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
    # True when `config.catalogs_hash` no longer matches the live catalogs
    # snapshot. Computed server-side so the hashing rule lives in one language.
    catalogs_stale: bool = False


class RecipientDetailResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    source_index: int | None = None
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
    # Post-publication lifecycle fields from the legacy template -- writable
    # via `PATCH /data-extraction/recommendations/{id}` (issue #58), see
    # `Recommendation` in `database/meta/recommendation.py`.
    file_number: str | None
    recommendation_detail: str | None
    recommendation_situation: RecommendationSituation | None
    status: RecommendationStatus | None
    approved_for_publication: bool | None
    link: str | None
    created_at: datetime
    # `onupdate` with no `server_default` -- null until the row is first
    # updated after creation.
    updated_at: datetime | None


class RecommendationDetailResponse(RecommendationResponse):
    source_text: str
    # The document's paragraphs as extracted; `None` for an extraction stored
    # before they were kept, where the client falls back to splitting
    # `source_text` on newlines.
    source_paragraphs: list[str] | None = None
    prediction: dict[str, Any]


class RecommendationPageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[RecommendationResponse]
    total: int
    page: int
    page_size: int


class DocumentExtractionEnvelopeResponse(BaseModel):
    """What the server holds for one document, before deciding to infer.

    Both slots nullable and independently meaningful: `prediction` alone means
    extracted but never validated; both populated means a human already
    validated and `prediction` is kept for the frozen suggestions and the
    in-document highlighting.
    """

    model_config = ConfigDict(extra="forbid")

    document_id: uuid.UUID
    prediction: DataExtractionResponse | None = None
    validation: RecommendationDetailResponse | None = None
    catalogs_stale: bool = False
    updated_at: datetime | None = None
