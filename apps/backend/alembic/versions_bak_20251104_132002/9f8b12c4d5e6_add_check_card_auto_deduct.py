"""add auto deduct support for check cards

Revision ID: 9f8b12c4d5e6
Revises: 8aa7b4a3cf12
Create Date: 2025-10-16 10:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9f8b12c4d5e6"
down_revision: Union[str, None] = "8aa7b4a3cf12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

balance_type_enum = sa.Enum("DIRECT", "LINKED", name="balancetype")


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None
    inspector = sa.inspect(bind) if bind else None

    if dialect == "postgresql":
        balance_type_enum.create(bind, checkfirst=True)

    account_cols = {col["name"] for col in inspector.get_columns("account")} if inspector else set()
    txn_cols = {col["name"] for col in inspector.get_columns("transaction")} if inspector else set()
    fk_names = {fk["name"] for fk in inspector.get_foreign_keys("transaction")} if inspector else set()
    idx_names = {idx["name"] for idx in inspector.get_indexes("transaction")} if inspector else set()
    unique_names = {uc["name"] for uc in inspector.get_unique_constraints("transaction")} if inspector else set()
    check_names = {chk["name"] for chk in inspector.get_check_constraints("transaction")} if inspector else set()

    if "balance_type" not in account_cols:
        op.add_column(
            "account",
            sa.Column("balance_type", balance_type_enum, nullable=False, server_default="DIRECT"),
        )
    if "auto_deduct" not in account_cols:
        op.add_column(
            "account",
            sa.Column("auto_deduct", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    op.execute(sa.text("UPDATE account SET balance_type = 'LINKED' WHERE type = 'CHECK_CARD'"))
    op.execute(
        sa.text("UPDATE account SET auto_deduct = 1 WHERE type = 'CHECK_CARD' AND linked_account_id IS NOT NULL")
    )

    if dialect != "sqlite":
        op.alter_column("account", "balance_type", server_default=None)
        op.alter_column("account", "auto_deduct", server_default=None)

    needs_unique = "uq_txn_linked_transaction_id" not in unique_names and "uq_txn_linked_transaction_id" not in idx_names

    if dialect == "sqlite":
        with op.batch_alter_table("transaction", recreate="always") as batch_op:
            if "linked_transaction_id" not in txn_cols:
                batch_op.add_column(sa.Column("linked_transaction_id", sa.Integer(), nullable=True))
            if "fk_transaction_linked_transaction_id" not in fk_names:
                batch_op.create_foreign_key(
                    "fk_transaction_linked_transaction_id",
                    "transaction",
                    ["linked_transaction_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
            if needs_unique:
                batch_op.create_unique_constraint("uq_txn_linked_transaction_id", ["linked_transaction_id"])
            if "ck_txn_not_link_self" not in check_names:
                batch_op.create_check_constraint(
                    "ck_txn_not_link_self", "linked_transaction_id IS NULL OR linked_transaction_id <> id"
                )
    else:
        if "linked_transaction_id" not in txn_cols:
            op.add_column("transaction", sa.Column("linked_transaction_id", sa.Integer(), nullable=True))
        if "fk_transaction_linked_transaction_id" not in fk_names:
            op.create_foreign_key(
                "fk_transaction_linked_transaction_id",
                "transaction",
                "transaction",
                ["linked_transaction_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if needs_unique:
            op.create_unique_constraint(
                "uq_txn_linked_transaction_id",
                "transaction",
                ["linked_transaction_id"],
            )
        if "ck_txn_not_link_self" not in check_names:
            op.create_check_constraint(
                "ck_txn_not_link_self",
                "transaction",
                "linked_transaction_id IS NULL OR linked_transaction_id <> id",
            )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None

    if dialect == "sqlite":
        with op.batch_alter_table("transaction", recreate="always") as batch_op:
            batch_op.drop_constraint("ck_txn_not_link_self", type_="check")
            batch_op.drop_constraint("uq_txn_linked_transaction_id", type_="unique")
            batch_op.drop_constraint("fk_transaction_linked_transaction_id", type_="foreignkey")
            batch_op.drop_column("linked_transaction_id")
    else:
        op.drop_constraint("ck_txn_not_link_self", "transaction", type_="check")
        op.drop_constraint("uq_txn_linked_transaction_id", "transaction", type_="unique")
        op.drop_constraint("fk_transaction_linked_transaction_id", "transaction", type_="foreignkey")
        op.drop_column("transaction", "linked_transaction_id")

    op.drop_column("account", "auto_deduct")
    op.drop_column("account", "balance_type")

    if dialect == "postgresql":
        balance_type_enum.drop(bind, checkfirst=False)
