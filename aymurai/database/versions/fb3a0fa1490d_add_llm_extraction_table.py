"""Add llm_extraction table

Revision ID: fb3a0fa1490d
Revises: ddf5877c18e3
Create Date: 2026-08-31 00:00:02.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fb3a0fa1490d"
down_revision: str | None = "ddf5877c18e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "llm_extraction",
        sa.Column("file_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("source_text", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("prediction", sa.JSON(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("llm_extraction")
