"""Add dataset, recommendation, recipient tables

Revision ID: bd2987fdfc0e
Revises: fb3a0fa1490d
Create Date: 2026-08-31 00:00:03.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bd2987fdfc0e"
down_revision: str | None = "fb3a0fa1490d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dataset",
        sa.Column("code", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index(op.f("ix_dataset_code"), "dataset", ["code"], unique=True)

    op.create_table(
        "recommendation",
        sa.Column("dataset_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column(
            "recommendation_number", sqlmodel.sql.sqltypes.AutoString(), nullable=True
        ),
        sa.Column(
            "recommendation_date_text",
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=True,
        ),
        sa.Column("recommendation_date", sa.Date(), nullable=True),
        sa.Column("topic_id", sa.Uuid(), nullable=True),
        sa.Column("subtopic_id", sa.Uuid(), nullable=True),
        sa.Column("personal_data", sa.Boolean(), nullable=True),
        sa.Column(
            "publishable_content", sqlmodel.sql.sqltypes.AutoString(), nullable=False
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["dataset_id"], ["dataset.id"]),
        sa.ForeignKeyConstraint(["topic_id"], ["topic.id"]),
        sa.ForeignKeyConstraint(["subtopic_id"], ["subtopic.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "dataset_id", "document_id", name="uq_recommendation_dataset_document"
        ),
    )
    op.create_index(
        op.f("ix_recommendation_dataset_id"),
        "recommendation",
        ["dataset_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_recommendation_document_id"),
        "recommendation",
        ["document_id"],
        unique=False,
    )

    op.create_table(
        "recipient",
        sa.Column("recommendation_id", sa.Uuid(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("raw_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("raw_position", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("normalized_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column(
            "normalized_position", sqlmodel.sql.sqltypes.AutoString(), nullable=True
        ),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("macro_sector_id", sa.Uuid(), nullable=True),
        sa.Column("unit_id", sa.Uuid(), nullable=True),
        sa.Column("sector_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["recommendation_id"], ["recommendation.id"]),
        sa.ForeignKeyConstraint(["macro_sector_id"], ["macro_sector.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["organigram_unit.id"]),
        sa.ForeignKeyConstraint(["sector_id"], ["organigram_unit.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_recipient_recommendation_id"),
        "recipient",
        ["recommendation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_recipient_normalized_name"),
        "recipient",
        ["normalized_name"],
        unique=False,
    )
    op.create_index(
        op.f("ix_recipient_normalized_position"),
        "recipient",
        ["normalized_position"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_recipient_normalized_position"), table_name="recipient")
    op.drop_index(op.f("ix_recipient_normalized_name"), table_name="recipient")
    op.drop_index(op.f("ix_recipient_recommendation_id"), table_name="recipient")
    op.drop_table("recipient")
    op.drop_index(op.f("ix_recommendation_document_id"), table_name="recommendation")
    op.drop_index(op.f("ix_recommendation_dataset_id"), table_name="recommendation")
    op.drop_table("recommendation")
    op.drop_index(op.f("ix_dataset_code"), table_name="dataset")
    op.drop_table("dataset")
