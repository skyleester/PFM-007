"""add auto transfer match flag

Revision ID: 1189df8c6f4e
Revises: 2d6c9a2e9f7d
Create Date: 2025-10-09 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "1189df8c6f4e"
down_revision: Union[str, None] = "2d6c9a2e9f7d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_auto_transfer_match", sa.Boolean(), nullable=False, server_default=sa.false()))

    op.execute(sa.text('UPDATE "transaction" SET is_auto_transfer_match = 0 WHERE is_auto_transfer_match IS NULL'))

    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.alter_column("is_auto_transfer_match", nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.drop_column("is_auto_transfer_match")