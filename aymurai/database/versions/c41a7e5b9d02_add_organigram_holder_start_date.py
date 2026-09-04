"""Add organigram_holder.start_date (when the holder took office)

The screen showed `created_at` as the holder's "since" date, which is the row's
insert timestamp -- fine while the only writes were "appoint someone now", but
wrong for recording a term that began before the organigram was seeded. This
adds the term date as its own column and backfills it from `created_at`, so
every existing row keeps displaying exactly the date it displayed before.

Revision ID: c41a7e5b9d02
Revises: bd2987fdfc0e
Create Date: 2026-09-04 12:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c41a7e5b9d02"
down_revision: str | None = "bd2987fdfc0e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "organigram_holder",
        sa.Column("start_date", sa.Date(), nullable=True),
    )
    # Backfill rather than leave NULL: the UI has always shown `created_at` as
    # the date, so carrying it over keeps every existing row reading the same
    # after the upgrade. Left nullable so a row whose term date is genuinely
    # unknown can say so instead of claiming its insert date.
    op.execute(
        "UPDATE organigram_holder SET start_date = DATE(created_at) "
        "WHERE start_date IS NULL"
    )


def downgrade() -> None:
    op.drop_column("organigram_holder", "start_date")
