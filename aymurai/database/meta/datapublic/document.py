import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Column, DateTime, func, text
from sqlmodel import Field, Relationship, SQLModel

from aymurai.database.meta.datapublic.document_paragraph import (
    DataPublicDocumentParagraph,
)
from aymurai.meta.api_interfaces import DataPublicDocumentAnnotations

if TYPE_CHECKING:
    from aymurai.database.meta.datapublic.paragraph import DataPublicParagraph


class DataPublicDocumentBase(SQLModel):
    prediction: DataPublicDocumentAnnotations | None = Field(
        None, sa_column=Column(JSON)
    )
    validation: DataPublicDocumentAnnotations | None = Field(
        None, sa_column=Column(JSON)
    )


class DataPublicDocument(DataPublicDocumentBase, table=True):
    __tablename__ = "datapublic_document"
    id: uuid.UUID | None = Field(None, primary_key=True)
    created_at: datetime = Field(
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime | None = Field(
        sa_column=Column(DateTime(), onupdate=func.now())
    )

    paragraphs: list["DataPublicParagraph"] = Relationship(
        back_populates="documents",
        link_model=DataPublicDocumentParagraph,
    )


class DataPublicDocumentCreate(DataPublicDocumentBase):
    pass


class DataPublicDocumentUpdate(DataPublicDocumentBase):
    prediction: DataPublicDocumentAnnotations | None = None
    validation: DataPublicDocumentAnnotations | None = None


class DataPublicDocumentRead(DataPublicDocumentBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
