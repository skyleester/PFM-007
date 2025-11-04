"""enforce zero balance for check cards

Revision ID: 8aa7b4a3cf12
Revises: 4c3d35baa2c6
Create Date: 2025-10-15 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8aa7b4a3cf12"
down_revision: Union[str, None] = "4c3d35baa2c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE account SET balance = 0 WHERE type = 'CHECK_CARD' AND (balance IS NULL OR balance <> 0)"))
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None

    if dialect == "sqlite":
        with op.batch_alter_table("account", recreate="always") as batch_op:
            batch_op.create_check_constraint(
                "ck_account_check_card_zero_balance",
                "(type <> 'CHECK_CARD') OR balance = 0",
            )
    else:
        op.create_check_constraint(
            "ck_account_check_card_zero_balance",
            "account",
            "(type <> 'CHECK_CARD') OR balance = 0",
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None

    if dialect == "sqlite":
        with op.batch_alter_table("account", recreate="always") as batch_op:
            batch_op.drop_constraint("ck_account_check_card_zero_balance", type_="check")
    else:
        op.drop_constraint("ck_account_check_card_zero_balance", "account", type_="check")
