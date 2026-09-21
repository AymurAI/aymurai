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
        "recommendation", sa.Column("recommendation_detail", sa.String(), nullable=True)
    )
    # Batched: SQLite's `ALTER TABLE ADD COLUMN` can't attach a CHECK
    # constraint (alembic silently skips it outside batch mode -- confirmed
    # empirically, it warns "Skipping unsupported ALTER for creation of
    # implicit constraint"). Batch mode recreates the table instead, so the
    # constraint actually lands, matching what `SQLModel.metadata.create_all`
    # produces for `_closed_catalog_column` in `database/meta/recommendation.py`.
    # The column is plain `String` here, not `sa.Enum(...)`: an `Enum` with
    # `create_constraint=True` registers its own `CheckConstraint` via a
    # `SchemaType` attach-event, and batch mode's reflect-then-recreate cycle
    # attaches the column twice -- emitting the same constraint twice
    # (confirmed empirically). A plain column plus an explicit
    # `create_check_constraint` sidesteps that and produces exactly one.
    with op.batch_alter_table("recommendation") as batch_op:
        batch_op.add_column(
            sa.Column("recommendation_situation", sa.String(), nullable=True)
        )
        batch_op.create_check_constraint(
            "ck_recommendation_recommendation_situation",
            "recommendation_situation IN ('Respuesta', 'Respuesta parcial', 'Notificado')",
        )
        batch_op.add_column(sa.Column("status", sa.String(), nullable=True))
        batch_op.create_check_constraint(
            "ck_recommendation_status",
            "status IN ('Solucionado', 'No solucionado')",
        )
    op.add_column(
        "recommendation",
        sa.Column("approved_for_publication", sa.Boolean(), nullable=True),
    )
    op.add_column("recommendation", sa.Column("link", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("recommendation", "link")
    op.drop_column("recommendation", "approved_for_publication")
    # Batched: SQLite refuses a plain `DROP COLUMN` on a column referenced by
    # a CHECK constraint, so these two need the same recreate-table strategy
    # as their addition above. The constraints have to be dropped by name
    # first -- batch mode's reflect-then-recreate doesn't infer that a
    # (separately created) named CHECK constraint depends on the column
    # being dropped, and silently carries it over otherwise, leaving the
    # recreated table referencing a column that no longer exists.
    with op.batch_alter_table("recommendation") as batch_op:
        batch_op.drop_constraint("ck_recommendation_status", type_="check")
        batch_op.drop_constraint(
            "ck_recommendation_recommendation_situation", type_="check"
        )
        batch_op.drop_column("status")
        batch_op.drop_column("recommendation_situation")
    op.drop_column("recommendation", "recommendation_detail")
    op.drop_column("recommendation", "initial_content")
    op.drop_column("recommendation", "file_number")
