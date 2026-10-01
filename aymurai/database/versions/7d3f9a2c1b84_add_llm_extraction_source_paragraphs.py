"""add llm_extraction.source_paragraphs

Revision ID: 7d3f9a2c1b84
Revises: fc05e46561dc
Create Date: 2026-10-01 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7d3f9a2c1b84"
down_revision: str | None = "fc05e46561dc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable with no backfill: rows extracted before this column existed
    # only have `source_text`, whose `"\n".join` already lost which newlines
    # were paragraph boundaries -- there is nothing to recover them from. The
    # correction screen falls back to splitting `source_text` for those.
    op.add_column(
        "llm_extraction", sa.Column("source_paragraphs", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("llm_extraction", "source_paragraphs")
