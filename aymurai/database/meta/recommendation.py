import uuid
from datetime import date, datetime

from sqlalchemy import Column, DateTime, UniqueConstraint, func, text
from sqlmodel import Field, SQLModel


class RecommendationBase(SQLModel):
    dataset_id: uuid.UUID = Field(foreign_key="dataset.id")
    document_id: uuid.UUID
    recommendation_number: str | None = None
    # Verbatim prose from the model/human; `recommendation_date` below is the
    # normalized parse of this, nullable since not every prose form parses.
    recommendation_date_text: str | None = None
    recommendation_date: date | None = None
    topic_id: uuid.UUID | None = Field(None, foreign_key="topic.id")
    subtopic_id: uuid.UUID | None = Field(None, foreign_key="subtopic.id")
    # Tri-state: None means "not yet answered", not "no personal data".
    personal_data: bool | None = None
    publishable_content: str


class Recommendation(RecommendationBase, table=True):
    __tablename__ = "recommendation"
    __table_args__ = (
        UniqueConstraint(
            "dataset_id", "document_id", name="uq_recommendation_dataset_document"
        ),
    )
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        sa_column=Column(DateTime(), onupdate=func.now())
    )


class RecommendationCreate(RecommendationBase):
    pass


class RecommendationUpdate(SQLModel):
    recommendation_number: str | None = None
    recommendation_date_text: str | None = None
    recommendation_date: date | None = None
    topic_id: uuid.UUID | None = None
    subtopic_id: uuid.UUID | None = None
    personal_data: bool | None = None
    publishable_content: str | None = None


class RecommendationRead(RecommendationBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
