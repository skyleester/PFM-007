"""Allow transfer transactions to carry categories

Revision ID: 86b68c223a47
Revises: e2cdd209771f
Create Date: 2025-10-06 16:55:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "86b68c223a47"
down_revision = "2a5f9c3ae1b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.drop_constraint("ck_txn_type_rules", type_="check")
        batch_op.create_check_constraint(
            "ck_txn_type_rules",
            "(type = 'TRANSFER' AND account_id IS NOT NULL AND counter_account_id IS NOT NULL) OR (type IN ('INCOME','EXPENSE'))",
        )


def downgrade() -> None:
    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.drop_constraint("ck_txn_type_rules", type_="check")
        batch_op.create_check_constraint(
            "ck_txn_type_rules",
            "(type = 'TRANSFER' AND account_id IS NOT NULL AND counter_account_id IS NOT NULL AND category_id IS NULL) OR (type IN ('INCOME','EXPENSE'))",
        )
