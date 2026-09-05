import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from aymurai.meta.api_interfaces import Document


class DataExtractionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: Document
    model: str | None = None
    options: dict[str, Any] | None = None


class RecipientValidationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Present when correcting an already-saved recipient, absent for a new
    # one -- lets the backend update/insert/delete precisely instead of
    # replacing the whole set, which is what kept `recipient.id` stable.
    id: uuid.UUID | None = None
    name: str | None = None
    position: str | None = None
    is_primary: bool = False
    macro_sector: str | None = None
    # Both chosen directly from a picker (organigram_unit ids), never a label
    # to resolve, and never derived one from the other -- a human validates
    # the specific unit ("cargo normalizado") and the sector independently.
    unit_id: uuid.UUID | None = None
    sector_id: uuid.UUID | None = None
    # Index into `extraction.prediction.recipients` this recipient came from;
    # None when the person added it by hand. Lets the form diff suggestion
    # against value without pairing the two lists by array position.
    source_index: int | None = None


class ValidateRecommendationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recommendation_number: str | None = None
    recommendation_date_text: str | None = None
    topic: str | None = None
    subtopic: str | None = None
    personal_data: bool | None = None
    publishable_content: str
    recipients: list[RecipientValidationRequest] = Field(default_factory=list)
