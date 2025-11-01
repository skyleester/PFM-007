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
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("transaction")}
    created = False
    if "is_auto_transfer_match" not in columns:
        op.add_column(
            "transaction",
            sa.Column("is_auto_transfer_match", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        created = True
    op.execute(sa.text('UPDATE "transaction" SET is_auto_transfer_match = 0'))
    if created:
        op.alter_column("transaction", "is_auto_transfer_match", server_default=None)


def downgrade() -> None:
    op.drop_column("transaction", "is_auto_transfer_match")