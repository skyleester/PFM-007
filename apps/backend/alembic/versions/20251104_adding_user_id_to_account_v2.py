"""add user_id to account_v2 and backfill

Revision ID: b2c7eea1add3
Revises: a1b2c3d4e5f6
Create Date: 2025-11-04 16:10:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b2c7eea1add3"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add user_id as nullable first
    with op.batch_alter_table("account_v2", schema=None) as batch_op:
        batch_op.add_column(sa.Column("user_id", sa.Integer(), nullable=True))

    # Backfill: set user_id to 1 (default demo) where NULL
    op.execute("UPDATE account_v2 SET user_id = 1 WHERE user_id IS NULL")

    # Set NOT NULL and add FK
    with op.batch_alter_table("account_v2", schema=None) as batch_op:
        batch_op.alter_column("user_id", existing_type=sa.Integer(), nullable=False)
        batch_op.create_foreign_key(
            "fk_accountv2_user",
            "user",
            ["user_id"],
            ["id"],
            ondelete=None,
        )


def downgrade() -> None:
    # Drop FK and column
    with op.batch_alter_table("account_v2", schema=None) as batch_op:
        batch_op.drop_constraint("fk_accountv2_user", type_="foreignkey")
        batch_op.drop_column("user_id")
