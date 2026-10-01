import uuid
from datetime import date, datetime
from enum import Enum

from sqlalchemy import Column, DateTime, UniqueConstraint, func, text
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel


class RecommendationSituation(str, Enum):
    RESPUESTA = "Respuesta"
    RESPUESTA_PARCIAL = "Respuesta parcial"
    NOTIFICADO = "Notificado"


class RecommendationStatus(str, Enum):
    SOLUCIONADO = "Solucionado"
    NO_SOLUCIONADO = "No solucionado"


def _closed_catalog_column(enum_cls: type[Enum], constraint_name: str) -> Column:
    """
    A nullable column restricted to `enum_cls`'s values.

    Stores the member's *value* (e.g. "Respuesta parcial"), not its Python
    name -- SQLAlchemy's `Enum` type persists by `.name` unless told
    otherwise via `values_callable`. `native_enum=False` keeps this a plain
    `VARCHAR` + `CHECK` constraint on every backend (SQLite has no native
    `ENUM` type; skipping it on Postgres too avoids `ALTER TYPE ... ADD
    VALUE` migrations if the catalog ever grows).
    """
    return Column(
        SAEnum(
            enum_cls,
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
            create_constraint=True,
            name=constraint_name,
        )
    )


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
    # Post-publication lifecycle fields from the legacy template -- writable
    # via `PATCH /data-extraction/recommendations/{id}` (issue #58), the
    # grilla de seguimiento's editing surface, and read by the export
    # (`data_extraction_export.py`). The validation wizard (Fase 8) doesn't
    # know them and must never write them: `recommendation_upsert` leaves
    # them alone. `recommendation_situation` and `status` are closed catalogs
    # (a DB-level CHECK constraint via `_closed_catalog_column`, on top of
    # the usual pydantic validation) -- any other value fails at
    # construction and at the DB layer, never silently stored.
    file_number: str | None = None
    recommendation_detail: str | None = None
    recommendation_situation: RecommendationSituation | None = Field(
        default=None,
        sa_column=_closed_catalog_column(
            RecommendationSituation, "ck_recommendation_recommendation_situation"
        ),
    )
    status: RecommendationStatus | None = Field(
        default=None,
        sa_column=_closed_catalog_column(
            RecommendationStatus, "ck_recommendation_status"
        ),
    )
    approved_for_publication: bool | None = None
    link: str | None = None


class RecommendationUpdate(SQLModel):
    """Capa DB del PATCH de seguimiento -- todo opcional, `exclude_unset=True`
    en el CRUD decide qué tocar. Nunca incluye campos de la extracción."""

    file_number: str | None = None
    recommendation_detail: str | None = None
    recommendation_situation: RecommendationSituation | None = None
    status: RecommendationStatus | None = None
    approved_for_publication: bool | None = None
    link: str | None = None


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
