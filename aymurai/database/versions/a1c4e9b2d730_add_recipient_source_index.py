"""add recipient.source_index

Revision ID: a1c4e9b2d730
Revises: c41a7e5b9d02
Create Date: 2026-09-04 12:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c4e9b2d730"
down_revision: str | None = "c41a7e5b9d02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("recipient", sa.Column("source_index", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("recipient", "source_index")
