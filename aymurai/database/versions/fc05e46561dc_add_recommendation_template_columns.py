"""add recommendation template columns

Revision ID: fc05e46561dc
Revises: a1c4e9b2d730
Create Date: 2026-09-18 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fc05e46561dc"
down_revision: str | None = "a1c4e9b2d730"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recommendation", sa.Column("file_number", sa.String(), nullable=True)
    )
    op.add_column(
        "recommendation", sa.Column("initial_content", sa.String(), nullable=True)
    )
    op.add_column(
        "recommendation", sa.Column("situation_status", sa.String(), nullable=True)
    )
    op.add_column("recommendation", sa.Column("status", sa.String(), nullable=True))
    op.add_column(
        "recommendation", sa.Column("resolved_in_file", sa.Boolean(), nullable=True)
    )
    op.add_column(
        "recommendation",
        sa.Column("approved_for_publication", sa.Boolean(), nullable=True),
    )
    op.add_column("recommendation", sa.Column("link", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("recommendation", "link")
    op.drop_column("recommendation", "approved_for_publication")
    op.drop_column("recommendation", "resolved_in_file")
    op.drop_column("recommendation", "status")
    op.drop_column("recommendation", "situation_status")
    op.drop_column("recommendation", "initial_content")
    op.drop_column("recommendation", "file_number")
