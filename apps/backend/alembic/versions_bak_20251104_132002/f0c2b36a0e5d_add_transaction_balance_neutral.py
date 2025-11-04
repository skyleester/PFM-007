"""Add is_balance_neutral flag to transactions

Revision ID: f0c2b36a0e5d
Revises: 86b68c223a47
Create Date: 2025-10-07 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f0c2b36a0e5d"
down_revision = "86b68c223a47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_balance_neutral", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Backfill existing rows (SQLite treats False as 0)
    op.execute(
        sa.text(
            'UPDATE "transaction" SET is_balance_neutral = :value WHERE is_balance_neutral IS NULL'
        ).bindparams(value=False)
    )

    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.alter_column("is_balance_neutral", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.drop_column("is_balance_neutral")
