"""Add variable amount support to recurring rules

Revision ID: 7b3a92d6d3a4
Revises: f0c2b36a0e5d
Create Date: 2025-10-11 04:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "7b3a92d6d3a4"
down_revision = "f0c2b36a0e5d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("recurringrule", schema=None) as batch_op:
        batch_op.alter_column("amount", existing_type=sa.Numeric(18, 4), nullable=True)
        batch_op.add_column(sa.Column("is_variable_amount", sa.Boolean(), nullable=False, server_default=sa.false()))

    # remove server default after backfill (SQLite: False -> 0)
    with op.batch_alter_table("recurringrule", schema=None) as batch_op:
        batch_op.alter_column("is_variable_amount", server_default=None)


def downgrade() -> None:
    # reset variable flags to ensure NOT NULL constraint won't fail when reverting
    op.execute(sa.text("UPDATE recurringrule SET is_variable_amount = 0 WHERE is_variable_amount IS NULL"))

    with op.batch_alter_table("recurringrule", schema=None) as batch_op:
        batch_op.drop_column("is_variable_amount")
        batch_op.alter_column("amount", existing_type=sa.Numeric(18, 4), nullable=False)
