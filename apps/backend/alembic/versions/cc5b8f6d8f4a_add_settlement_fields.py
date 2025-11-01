"""Add settlement transaction fields and constraints

Revision ID: cc5b8f6d8f4a
Revises: fb8c0a1f2a1b
Create Date: 2025-10-18 09:30:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cc5b8f6d8f4a"
down_revision: Union[str, Sequence[str], None] = "fb8c0a1f2a1b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def _refresh_transaction_metadata(bind):
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("transaction")}
    indexes = {idx["name"] for idx in inspector.get_indexes("transaction")}
    checks = {ck["name"] for ck in inspector.get_check_constraints("transaction")}
    uniques = {uq["name"] for uq in inspector.get_unique_constraints("transaction")}
    fks = {fk["name"] for fk in inspector.get_foreign_keys("transaction")}
    return columns, indexes, checks, uniques, fks


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None

    if dialect == "postgresql":
        op.execute(sa.text("ALTER TYPE txntype ADD VALUE IF NOT EXISTS 'SETTLEMENT'"))

    columns, indexes, checks, uniques, fks = _refresh_transaction_metadata(bind)

    if dialect == "sqlite":
        # Clean up leftover temp table if a prior failed batch left it around
        op.execute(sa.text('DROP TABLE IF EXISTS _alembic_tmp_transaction'))
        with op.batch_alter_table("transaction", recreate="always") as batch_op:
            if "card_id" not in columns:
                batch_op.add_column(sa.Column("card_id", sa.Integer(), nullable=True))
            if "imported_source_id" not in columns:
                batch_op.add_column(sa.Column("imported_source_id", sa.String(length=128), nullable=True))
            if "is_card_charge" not in columns:
                # add as NULLABLE during copy; we'll backfill and keep nullable for SQLite
                batch_op.add_column(sa.Column("is_card_charge", sa.Boolean(), nullable=True, server_default=sa.false()))

            if "ck_txn_type_rules" in checks:
                batch_op.drop_constraint("ck_txn_type_rules", type_="check")
            batch_op.create_check_constraint(
                "ck_txn_type_rules",
                "(type = 'TRANSFER' AND counter_account_id IS NOT NULL) OR "
                "(type IN ('INCOME','EXPENSE','SETTLEMENT') AND counter_account_id IS NULL)",
            )
            if "ck_txn_card_charge_requires_card" not in checks:
                batch_op.create_check_constraint(
                    "ck_txn_card_charge_requires_card",
                    "NOT is_card_charge OR (type = 'EXPENSE' AND card_id IS NOT NULL)",
                )
            if "ck_txn_settlement_requires_card" not in checks:
                batch_op.create_check_constraint(
                    "ck_txn_settlement_requires_card",
                    "(type != 'SETTLEMENT') OR card_id IS NOT NULL",
                )
            if "ck_txn_settlement_not_neutral" not in checks:
                batch_op.create_check_constraint(
                    "ck_txn_settlement_not_neutral",
                    "NOT (type = 'SETTLEMENT' AND is_balance_neutral)",
                )

            if "uq_txn_imported_source_id" not in uniques:
                batch_op.create_unique_constraint(
                    "uq_txn_imported_source_id",
                    ["user_id", "imported_source_id"],
                )
            if "fk_transaction_card" not in fks:
                batch_op.create_foreign_key(
                    "fk_transaction_card",
                    "account",
                    ["card_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
            if "ix_txn_card_id" not in indexes:
                batch_op.create_index("ix_txn_card_id", ["card_id"], unique=False)
    else:
        if "card_id" not in columns:
            op.add_column("transaction", sa.Column("card_id", sa.Integer(), nullable=True))
        if "imported_source_id" not in columns:
            op.add_column("transaction", sa.Column("imported_source_id", sa.String(length=128), nullable=True))
        if "is_card_charge" not in columns:
            op.add_column(
                "transaction",
                sa.Column("is_card_charge", sa.Boolean(), nullable=False, server_default=sa.false()),
            )

        if "fk_transaction_card" not in fks:
            op.create_foreign_key(
                "fk_transaction_card",
                "transaction",
                "account",
                ["card_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "ix_txn_card_id" not in indexes:
            op.create_index("ix_txn_card_id", "transaction", ["card_id"], unique=False)
        if "uq_txn_imported_source_id" not in uniques:
            op.create_unique_constraint(
                "uq_txn_imported_source_id",
                "transaction",
                ["user_id", "imported_source_id"],
            )

        if "ck_txn_type_rules" in checks:
            op.drop_constraint("ck_txn_type_rules", "transaction", type_="check")
        op.create_check_constraint(
            "ck_txn_type_rules",
            "transaction",
            "(type = 'TRANSFER' AND counter_account_id IS NOT NULL) OR "
            "(type IN ('INCOME','EXPENSE','SETTLEMENT') AND counter_account_id IS NULL)",
        )
        if "ck_txn_card_charge_requires_card" not in checks:
            op.create_check_constraint(
                "ck_txn_card_charge_requires_card",
                "transaction",
                "NOT is_card_charge OR (type = 'EXPENSE' AND card_id IS NOT NULL)",
            )
        if "ck_txn_settlement_requires_card" not in checks:
            op.create_check_constraint(
                "ck_txn_settlement_requires_card",
                "transaction",
                "(type != 'SETTLEMENT') OR card_id IS NOT NULL",
            )
        if "ck_txn_settlement_not_neutral" not in checks:
            op.create_check_constraint(
                "ck_txn_settlement_not_neutral",
                "transaction",
                "NOT (type = 'SETTLEMENT' AND is_balance_neutral)",
            )

        # leave server_default for now; will be dropped in common tail

    # Common tail: backfill and enforce constraints/default cleanup
    if dialect == "sqlite":
        # Backfill any NULLs to 0; keep default as-is (SQLite doesn't support ALTER COLUMN to drop default)
        op.execute(sa.text('UPDATE "transaction" SET is_card_charge = 0 WHERE is_card_charge IS NULL'))
    else:
        op.alter_column("transaction", "is_card_charge", server_default=None)

    op.execute(
        sa.text(
            """
            UPDATE "transaction"
            SET card_id = account_id
            WHERE card_id IS NULL
              AND account_id IN (SELECT id FROM "account" WHERE type = 'CREDIT_CARD')
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE "transaction"
            SET card_id = (
                SELECT cc.account_id FROM "creditcardstatement" AS cc
                WHERE cc.id = "transaction".statement_id
            )
            WHERE statement_id IS NOT NULL
              AND card_id IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE "transaction"
            SET is_card_charge = :flag
            WHERE account_id IN (SELECT id FROM "account" WHERE type = 'CREDIT_CARD')
              AND type IN ('INCOME','EXPENSE')
            """
        ).bindparams(flag=True)
    )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None

    columns, indexes, checks, uniques, fks = _refresh_transaction_metadata(bind)

    if dialect == "sqlite":
        with op.batch_alter_table("transaction", recreate="always") as batch_op:
            if "ix_txn_card_id" in indexes:
                batch_op.drop_index("ix_txn_card_id")
            if "fk_transaction_card" in fks:
                batch_op.drop_constraint("fk_transaction_card", type_="foreignkey")
            if "uq_txn_imported_source_id" in uniques:
                batch_op.drop_constraint("uq_txn_imported_source_id", type_="unique")
            if "ck_txn_card_charge_requires_card" in checks:
                batch_op.drop_constraint("ck_txn_card_charge_requires_card", type_="check")
            if "ck_txn_settlement_requires_card" in checks:
                batch_op.drop_constraint("ck_txn_settlement_requires_card", type_="check")
            if "ck_txn_settlement_not_neutral" in checks:
                batch_op.drop_constraint("ck_txn_settlement_not_neutral", type_="check")
            if "ck_txn_type_rules" in checks:
                batch_op.drop_constraint("ck_txn_type_rules", type_="check")
                batch_op.create_check_constraint(
                    "ck_txn_type_rules",
                    "(type = 'TRANSFER' AND counter_account_id IS NOT NULL) OR (type IN ('INCOME','EXPENSE') AND counter_account_id IS NULL)",
                )
            if "is_card_charge" in columns:
                batch_op.drop_column("is_card_charge")
            if "imported_source_id" in columns:
                batch_op.drop_column("imported_source_id")
            if "card_id" in columns:
                batch_op.drop_column("card_id")
    else:
        if "ix_txn_card_id" in indexes:
            op.drop_index("ix_txn_card_id", table_name="transaction")
        if "fk_transaction_card" in fks:
            op.drop_constraint("fk_transaction_card", "transaction", type_="foreignkey")
        if "uq_txn_imported_source_id" in uniques:
            op.drop_constraint("uq_txn_imported_source_id", "transaction", type_="unique")
        if "ck_txn_card_charge_requires_card" in checks:
            op.drop_constraint("ck_txn_card_charge_requires_card", "transaction", type_="check")
        if "ck_txn_settlement_requires_card" in checks:
            op.drop_constraint("ck_txn_settlement_requires_card", "transaction", type_="check")
        if "ck_txn_settlement_not_neutral" in checks:
            op.drop_constraint("ck_txn_settlement_not_neutral", "transaction", type_="check")
        if "ck_txn_type_rules" in checks:
            op.drop_constraint("ck_txn_type_rules", "transaction", type_="check")
            op.create_check_constraint(
                "ck_txn_type_rules",
                "transaction",
                "(type = 'TRANSFER' AND counter_account_id IS NOT NULL) OR (type IN ('INCOME','EXPENSE') AND counter_account_id IS NULL)",
            )
        if "is_card_charge" in columns:
            op.drop_column("transaction", "is_card_charge")
        if "imported_source_id" in columns:
            op.drop_column("transaction", "imported_source_id")
        if "card_id" in columns:
            op.drop_column("transaction", "card_id")

    if dialect == "postgresql":
        op.execute(sa.text("DELETE FROM \"transaction\" WHERE type = 'SETTLEMENT'"))
        op.execute(sa.text("ALTER TABLE \"transaction\" ALTER COLUMN type DROP DEFAULT"))
        op.execute(sa.text("ALTER TYPE txntype RENAME TO txntype_old"))
        sa.Enum("INCOME", "EXPENSE", "TRANSFER", name="txntype").create(bind)
        op.execute(sa.text("ALTER TABLE \"transaction\" ALTER COLUMN type TYPE txntype USING type::text::txntype"))
    op.execute(sa.text("DROP TYPE txntype_old"))