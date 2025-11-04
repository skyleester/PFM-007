"""Add recurring candidate exclusion table

Revision ID: c9f01b2d3e45
Revises: 1189df8c6f4e
Create Date: 2025-10-12 10:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c9f01b2d3e45"
down_revision: Union[str, None] = "1189df8c6f4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    table_name = "recurringcandidateexclusion"

    existing_tables = inspector.get_table_names()
    if table_name not in existing_tables:
        # Fresh create
        op.create_table(
            table_name,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
            sa.Column("signature_hash", sa.String(length=64), nullable=False),
            sa.Column("snapshot", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("user_id", "signature_hash", name="uq_recurring_candidate_exclusion"),
        )
        op.create_index(
            "ix_recurring_exclusion_user_created",
            table_name,
            ["user_id", "created_at"],
            unique=False,
        )
    else:
        # Table already exists (possibly from a manual create or previous partial run).
        # Ensure the expected index exists; skip if already present.
        existing_indexes = {ix.get("name") for ix in inspector.get_indexes(table_name)}
        if "ix_recurring_exclusion_user_created" not in existing_indexes:
            op.create_index(
                "ix_recurring_exclusion_user_created",
                table_name,
                ["user_id", "created_at"],
                unique=False,
            )
    # No ALTER needed for SQLite; handle only create-if-missing to keep idempotent.


def downgrade() -> None:
    op.drop_index("ix_recurring_exclusion_user_created", table_name="recurringcandidateexclusion")
    op.drop_table("recurringcandidateexclusion")
