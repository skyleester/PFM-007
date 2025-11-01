"""introduce credit card accounts and statements

Revision ID: fb8c0a1f2a1b
Revises: 4a7b0bbbc6d1, 5b2a4c9ad4b1, 9f8b12c4d5e6
Create Date: 2025-10-30 12:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "fb8c0a1f2a1b"
down_revision: Union[str, Sequence[str], None] = ("4a7b0bbbc6d1", "5b2a4c9ad4b1", "9f8b12c4d5e6")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

transaction_status_enum = sa.Enum("CLEARED", "PENDING_PAYMENT", name="transactionstatus")
statement_status_enum = sa.Enum("pending", "closed", "paid", name="creditcardstatementstatus")


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None
    inspector = sa.inspect(bind)

    if dialect == "postgresql":
        op.execute(sa.text("ALTER TYPE accounttype ADD VALUE IF NOT EXISTS 'CREDIT_CARD'"))

    transaction_status_enum.create(bind, checkfirst=True)
    statement_status_enum.create(bind, checkfirst=True)

    account_columns = {column["name"] for column in inspector.get_columns("account")}
    account_checks = {check["name"] for check in inspector.get_check_constraints("account")}

    if dialect == "sqlite":
        with op.batch_alter_table("account", recreate="always") as batch_op:
            if "billing_cutoff_day" not in account_columns:
                batch_op.add_column(sa.Column("billing_cutoff_day", sa.Integer(), nullable=True))
            if "payment_day" not in account_columns:
                batch_op.add_column(sa.Column("payment_day", sa.Integer(), nullable=True))
            if "ck_account_check_card_zero_balance" in account_checks:
                batch_op.drop_constraint("ck_account_check_card_zero_balance", type_="check")
            if "ck_account_card_zero_balance" not in account_checks:
                batch_op.create_check_constraint(
                    "ck_account_card_zero_balance",
                    "(type NOT IN ('CHECK_CARD','CREDIT_CARD')) OR balance = 0",
                )
            if "ck_account_billing_cutoff_range" not in account_checks:
                batch_op.create_check_constraint(
                    "ck_account_billing_cutoff_range",
                    "billing_cutoff_day IS NULL OR (billing_cutoff_day >= 1 AND billing_cutoff_day <= 31)",
                )
            if "ck_account_payment_day_range" not in account_checks:
                batch_op.create_check_constraint(
                    "ck_account_payment_day_range",
                    "payment_day IS NULL OR (payment_day >= 1 AND payment_day <= 31)",
                )
            if "ck_credit_card_requires_link" not in account_checks:
                batch_op.create_check_constraint(
                    "ck_credit_card_requires_link",
                    "type != 'CREDIT_CARD' OR linked_account_id IS NOT NULL",
                )
            if "ck_credit_card_requires_schedule" not in account_checks:
                batch_op.create_check_constraint(
                    "ck_credit_card_requires_schedule",
                    "type != 'CREDIT_CARD' OR (billing_cutoff_day IS NOT NULL AND payment_day IS NOT NULL)",
                )
    else:
        if "billing_cutoff_day" not in account_columns:
            op.add_column("account", sa.Column("billing_cutoff_day", sa.Integer(), nullable=True))
        if "payment_day" not in account_columns:
            op.add_column("account", sa.Column("payment_day", sa.Integer(), nullable=True))
        if "ck_account_check_card_zero_balance" in account_checks:
            op.drop_constraint("ck_account_check_card_zero_balance", "account", type_="check")
        if "ck_account_card_zero_balance" not in account_checks:
            op.create_check_constraint(
                "ck_account_card_zero_balance",
                "account",
                "(type NOT IN ('CHECK_CARD','CREDIT_CARD')) OR balance = 0",
            )
        if "ck_account_billing_cutoff_range" not in account_checks:
            op.create_check_constraint(
                "ck_account_billing_cutoff_range",
                "account",
                "billing_cutoff_day IS NULL OR (billing_cutoff_day >= 1 AND billing_cutoff_day <= 31)",
            )
        if "ck_account_payment_day_range" not in account_checks:
            op.create_check_constraint(
                "ck_account_payment_day_range",
                "account",
                "payment_day IS NULL OR (payment_day >= 1 AND payment_day <= 31)",
            )
        if "ck_credit_card_requires_link" not in account_checks:
            op.create_check_constraint(
                "ck_credit_card_requires_link",
                "account",
                "type != 'CREDIT_CARD' OR linked_account_id IS NOT NULL",
            )
        if "ck_credit_card_requires_schedule" not in account_checks:
            op.create_check_constraint(
                "ck_credit_card_requires_schedule",
                "account",
                "type != 'CREDIT_CARD' OR (billing_cutoff_day IS NOT NULL AND payment_day IS NOT NULL)",
            )

    if not inspector.has_table("creditcardstatement"):
        op.create_table(
            "creditcardstatement",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("account_id", sa.Integer(), nullable=False),
            sa.Column("period_start", sa.Date(), nullable=False),
            sa.Column("period_end", sa.Date(), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column("total_amount", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("status", statement_status_enum, nullable=False, server_default="pending"),
            sa.Column("settlement_transaction_id", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], name="fk_creditcardstatement_user"),
            sa.ForeignKeyConstraint(["account_id"], ["account.id"], ondelete="CASCADE", name="fk_creditcardstatement_account"),
            sa.ForeignKeyConstraint(
                ["settlement_transaction_id"],
                ["transaction.id"],
                ondelete="SET NULL",
                name="fk_creditcardstatement_settlement",
            ),
        )
        op.create_index(
            "ix_creditcardstatement_account_period",
            "creditcardstatement",
            ["account_id", "period_end"],
        )

    transaction_columns = {column["name"] for column in inspector.get_columns("transaction")}
    transaction_indexes = {index["name"] for index in inspector.get_indexes("transaction")}
    transaction_fks = {fk["name"] for fk in inspector.get_foreign_keys("transaction")}

    created_status_column = False
    if dialect == "sqlite":
        with op.batch_alter_table("transaction", recreate="always") as batch_op:
            if "status" not in transaction_columns:
                batch_op.add_column(
                    sa.Column("status", transaction_status_enum, nullable=False, server_default="CLEARED"),
                )
                created_status_column = True
            if "statement_id" not in transaction_columns:
                batch_op.add_column(sa.Column("statement_id", sa.Integer(), nullable=True))
            if "fk_transaction_statement" not in transaction_fks:
                batch_op.create_foreign_key(
                    "fk_transaction_statement",
                    "creditcardstatement",
                    ["statement_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
            if "ix_transaction_statement_id" not in transaction_indexes:
                batch_op.create_index("ix_transaction_statement_id", ["statement_id"])
    else:
        if "status" not in transaction_columns:
            op.add_column(
                "transaction",
                sa.Column("status", transaction_status_enum, nullable=False, server_default="CLEARED"),
            )
            created_status_column = True
        if "statement_id" not in transaction_columns:
            op.add_column("transaction", sa.Column("statement_id", sa.Integer(), nullable=True))
        if "fk_transaction_statement" not in transaction_fks:
            op.create_foreign_key(
                "fk_transaction_statement",
                "transaction",
                "creditcardstatement",
                ["statement_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "ix_transaction_statement_id" not in transaction_indexes:
            op.create_index("ix_transaction_statement_id", "transaction", ["statement_id"])

    if created_status_column and dialect != "sqlite":
        op.alter_column("transaction", "status", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None
    inspector = sa.inspect(bind)

    transaction_indexes = {index["name"] for index in inspector.get_indexes("transaction")}
    if "ix_transaction_statement_id" in transaction_indexes:
        op.drop_index("ix_transaction_statement_id", table_name="transaction")

    transaction_fks = {fk["name"] for fk in inspector.get_foreign_keys("transaction")}
    if "fk_transaction_statement" in transaction_fks:
        op.drop_constraint("fk_transaction_statement", "transaction", type_="foreignkey")

    transaction_columns = {column["name"] for column in inspector.get_columns("transaction")}
    if "statement_id" in transaction_columns:
        op.drop_column("transaction", "statement_id")
    if "status" in transaction_columns:
        op.drop_column("transaction", "status")

    if inspector.has_table("creditcardstatement"):
        creditcard_indexes = {index["name"] for index in inspector.get_indexes("creditcardstatement")}
        if "ix_creditcardstatement_account_period" in creditcard_indexes:
            op.drop_index("ix_creditcardstatement_account_period", table_name="creditcardstatement")
        op.drop_table("creditcardstatement")

    account_checks = {check["name"] for check in inspector.get_check_constraints("account")}
    account_columns = {column["name"] for column in inspector.get_columns("account")}

    if dialect == "sqlite":
        with op.batch_alter_table("account", recreate="always") as batch_op:
            if "ck_credit_card_requires_schedule" in account_checks:
                batch_op.drop_constraint("ck_credit_card_requires_schedule", type_="check")
            if "ck_credit_card_requires_link" in account_checks:
                batch_op.drop_constraint("ck_credit_card_requires_link", type_="check")
            if "ck_account_payment_day_range" in account_checks:
                batch_op.drop_constraint("ck_account_payment_day_range", type_="check")
            if "ck_account_billing_cutoff_range" in account_checks:
                batch_op.drop_constraint("ck_account_billing_cutoff_range", type_="check")
            if "ck_account_card_zero_balance" in account_checks:
                batch_op.drop_constraint("ck_account_card_zero_balance", type_="check")
            if "payment_day" in account_columns:
                batch_op.drop_column("payment_day")
            if "billing_cutoff_day" in account_columns:
                batch_op.drop_column("billing_cutoff_day")
            if "ck_account_check_card_zero_balance" not in account_checks:
                batch_op.create_check_constraint(
                    "ck_account_check_card_zero_balance",
                    "(type <> 'CHECK_CARD') OR balance = 0",
                )
    else:
        if "ck_credit_card_requires_schedule" in account_checks:
            op.drop_constraint("ck_credit_card_requires_schedule", "account", type_="check")
        if "ck_credit_card_requires_link" in account_checks:
            op.drop_constraint("ck_credit_card_requires_link", "account", type_="check")
        if "ck_account_payment_day_range" in account_checks:
            op.drop_constraint("ck_account_payment_day_range", "account", type_="check")
        if "ck_account_billing_cutoff_range" in account_checks:
            op.drop_constraint("ck_account_billing_cutoff_range", "account", type_="check")
        if "ck_account_card_zero_balance" in account_checks:
            op.drop_constraint("ck_account_card_zero_balance", "account", type_="check")
        if "payment_day" in account_columns:
            op.drop_column("account", "payment_day")
        if "billing_cutoff_day" in account_columns:
            op.drop_column("account", "billing_cutoff_day")
        if "ck_account_check_card_zero_balance" not in account_checks:
            op.create_check_constraint(
                "ck_account_check_card_zero_balance",
                "account",
                "(type <> 'CHECK_CARD') OR balance = 0",
            )

    statement_status_enum.drop(bind, checkfirst=True)
    transaction_status_enum.drop(bind, checkfirst=True)
    # Enum value CREDIT_CARD remains in accounttype; removing enum values on downgrade is not supported on PostgreSQL.
