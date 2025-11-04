"""add transaction exclusion flag

Revision ID: 5b2a4c9ad4b1
Revises: 1189df8c6f4e
Create Date: 2025-10-13 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5b2a4c9ad4b1"
down_revision: Union[str, Sequence[str], None] = "bb7f34c5d6c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    dialect = bind.dialect.name
    columns = {col["name"] for col in inspector.get_columns("transaction")}
    created = False
    if "exclude_from_reports" not in columns:
        op.add_column(
            "transaction",
            sa.Column("exclude_from_reports", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        created = True
    op.execute(sa.text('UPDATE "transaction" SET exclude_from_reports = 0'))
    if created and dialect != "sqlite":
        op.alter_column("transaction", "exclude_from_reports", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("transaction")}
    if "exclude_from_reports" in columns:
        op.drop_column("transaction", "exclude_from_reports")
