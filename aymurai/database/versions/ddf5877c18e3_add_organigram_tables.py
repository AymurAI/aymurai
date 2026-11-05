"""Add organigram tables (organigram_unit, organigram_holder)

Revision ID: ddf5877c18e3
Revises: dd89f40c7c3e
Create Date: 2026-08-31 00:00:01.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ddf5877c18e3"
down_revision: str | None = "dd89f40c7c3e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "organigram_unit",
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("acronym", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("short_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("is_sector", sa.Boolean(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["parent_id"], ["organigram_unit.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_organigram_unit_parent_id"),
        "organigram_unit",
        ["parent_id"],
        unique=False,
    )

    op.create_table(
        "organigram_holder",
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["unit_id"], ["organigram_unit.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_organigram_holder_unit_id"),
        "organigram_holder",
        ["unit_id"],
        unique=False,
    )
    # Partial unique index: at most one current holder per unit. `is_current`
    # is a curated flag, not "the latest row" -- this is what makes that true
    # at the database level, not just by convention in the CRUD layer.
    op.create_index(
        "uq_organigram_holder_unit_id_current",
        "organigram_holder",
        ["unit_id"],
        unique=True,
        sqlite_where=sa.text("is_current = 1"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_organigram_holder_unit_id_current", table_name="organigram_holder"
    )
    op.drop_index(op.f("ix_organigram_holder_unit_id"), table_name="organigram_holder")
    op.drop_table("organigram_holder")
    op.drop_index(op.f("ix_organigram_unit_parent_id"), table_name="organigram_unit")
    op.drop_table("organigram_unit")
