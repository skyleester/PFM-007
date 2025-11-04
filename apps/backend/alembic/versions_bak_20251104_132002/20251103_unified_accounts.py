"""unify account model with from/to transactions

Revision ID: 20251103_unified_accounts
Revises: c1a2b3d4e5f6
Create Date: 2025-11-03 12:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20251103_unified_accounts"
down_revision: Union[str, None] = "c1a2b3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    # --- accounts -----------------------------------------------------------
    with op.batch_alter_table("account", schema=None) as batch_op:
        batch_op.add_column(sa.Column("category", sa.String(length=50)))
        batch_op.add_column(sa.Column("institution", sa.String(length=120)))
        batch_op.add_column(sa.Column("current_balance", sa.Numeric(18, 4), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("available_balance", sa.Numeric(18, 4)))
        batch_op.add_column(sa.Column("credit_limit", sa.Numeric(18, 4)))
        batch_op.add_column(sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch_op.add_column(sa.Column("opened_at", sa.Date()))
        batch_op.add_column(sa.Column("closed_at", sa.Date()))
        batch_op.add_column(sa.Column("memo", sa.Text()))
        batch_op.add_column(sa.Column("extra_metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))

    # migrate existing balance/is_archived into new columns
    account_table = sa.table(
        "account",
        sa.column("id", sa.Integer()),
        sa.column("balance", sa.Numeric(18, 4)),
        sa.column("current_balance", sa.Numeric(18, 4)),
        sa.column("is_archived", sa.Boolean()),
        sa.column("is_active", sa.Boolean()),
        sa.column("extra_metadata", sa.JSON()),
        sa.column("type", sa.String()),
        sa.column("billing_cutoff_day", sa.Integer()),
        sa.column("payment_day", sa.Integer()),
        sa.column("auto_deduct", sa.Boolean()),
    )
    # Use SQL expression to copy values; JSON manipulation differs per dialect.
    if is_sqlite:
        op.execute(
            "UPDATE account SET current_balance = balance"
        )
        op.execute(
            "UPDATE account SET is_active = CASE WHEN is_archived = 1 THEN 0 ELSE 1 END"
        )
    else:
        op.execute(account_table.update().values(current_balance=account_table.c.balance))
        op.execute(
            account_table.update().values(
                is_active=sa.case((account_table.c.is_archived == sa.true(), sa.false()), else_=sa.true())
            )
        )

    # Persist credit-card settings into JSON metadata
    op.execute(
        """
        UPDATE account
        SET extra_metadata = json_set(
            COALESCE(extra_metadata, json_object()),
            '$.billing_cutoff_day', billing_cutoff_day,
            '$.payment_day', payment_day,
            '$.auto_deduct', COALESCE(auto_deduct, 0)
        )
        WHERE type = 'CREDIT_CARD'
        """ if is_sqlite else
        """
        UPDATE account
        SET extra_metadata = jsonb_set(
            jsonb_set(
                jsonb_set(COALESCE(extra_metadata, '{}'::jsonb), '{billing_cutoff_day}', to_jsonb(billing_cutoff_day), true),
                '{payment_day}', to_jsonb(payment_day), true
            ),
            '{auto_deduct}', to_jsonb(COALESCE(auto_deduct, false)), true
        )
        WHERE type = 'CREDIT_CARD'
        """
    )

    # Drop legacy columns now captured in metadata/renamed fields
    with op.batch_alter_table("account", schema=None) as batch_op:
        batch_op.drop_column("balance")
        batch_op.drop_column("is_archived")
        batch_op.drop_column("auto_deduct")
        batch_op.drop_column("billing_cutoff_day")
        batch_op.drop_column("payment_day")
        batch_op.drop_column("balance_type")

    # --- transactions -------------------------------------------------------
    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.add_column(sa.Column("from_account_id", sa.Integer()))
        batch_op.add_column(sa.Column("to_account_id", sa.Integer()))
        batch_op.add_column(sa.Column("card_account_id", sa.Integer()))

    # migrate directional columns
    transaction_table = sa.table(
        "transaction",
        sa.column("id", sa.Integer()),
        sa.column("type", sa.String()),
        sa.column("account_id", sa.Integer()),
        sa.column("counter_account_id", sa.Integer()),
        sa.column("from_account_id", sa.Integer()),
        sa.column("to_account_id", sa.Integer()),
        sa.column("card_id", sa.Integer()),
        sa.column("card_account_id", sa.Integer()),
    )
    if is_sqlite:
        op.execute("UPDATE transaction SET from_account_id = account_id WHERE type IN ('TRANSFER','EXPENSE','SETTLEMENT')")
        op.execute("UPDATE transaction SET to_account_id = account_id WHERE type = 'INCOME'")
        op.execute("UPDATE transaction SET to_account_id = counter_account_id WHERE type IN ('TRANSFER','SETTLEMENT')")
        op.execute("UPDATE transaction SET card_account_id = card_id WHERE card_id IS NOT NULL")
    else:
        op.execute(
            transaction_table.update()
            .where(transaction_table.c.type.in_(['TRANSFER', 'EXPENSE', 'SETTLEMENT']))
            .values(from_account_id=transaction_table.c.account_id)
        )
        op.execute(
            transaction_table.update()
            .where(transaction_table.c.type == 'INCOME')
            .values(to_account_id=transaction_table.c.account_id)
        )
        op.execute(
            transaction_table.update()
            .where(transaction_table.c.type.in_(['TRANSFER', 'SETTLEMENT']))
            .values(to_account_id=transaction_table.c.counter_account_id)
        )
        op.execute(
            transaction_table.update()
            .where(transaction_table.c.card_id.isnot(None))
            .values(card_account_id=transaction_table.c.card_id)
        )

    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.drop_column("account_id")
        batch_op.drop_column("counter_account_id")
        batch_op.drop_column("card_id")

    with op.batch_alter_table("transaction", schema=None) as batch_op:
        batch_op.create_foreign_key("transaction_from_account_id_fkey", "account", ["from_account_id"], ["id"])
        batch_op.create_foreign_key("transaction_to_account_id_fkey", "account", ["to_account_id"], ["id"])
        batch_op.create_foreign_key("transaction_card_account_id_fkey", "account", ["card_account_id"], ["id"])

    # --- recurring rules ----------------------------------------------------
    with op.batch_alter_table("recurringrule", schema=None) as batch_op:
        batch_op.add_column(sa.Column("from_account_id", sa.Integer()))
        batch_op.add_column(sa.Column("to_account_id", sa.Integer()))

    if is_sqlite:
        op.execute("UPDATE recurringrule SET from_account_id = account_id WHERE type IN ('TRANSFER','EXPENSE')")
        op.execute("UPDATE recurringrule SET to_account_id = account_id WHERE type = 'INCOME'")
        op.execute("UPDATE recurringrule SET to_account_id = counter_account_id WHERE type = 'TRANSFER'")
    else:
        rr_table = sa.table(
            "recurringrule",
            sa.column("type", sa.String()),
            sa.column("account_id", sa.Integer()),
            sa.column("counter_account_id", sa.Integer()),
            sa.column("from_account_id", sa.Integer()),
            sa.column("to_account_id", sa.Integer()),
        )
        op.execute(
            rr_table.update()
            .where(rr_table.c.type.in_(['TRANSFER', 'EXPENSE']))
            .values(from_account_id=rr_table.c.account_id)
        )
        op.execute(
            rr_table.update()
            .where(rr_table.c.type == 'INCOME')
            .values(to_account_id=rr_table.c.account_id)
        )
        op.execute(
            rr_table.update()
            .where(rr_table.c.type == 'TRANSFER')
            .values(to_account_id=rr_table.c.counter_account_id)
        )

    with op.batch_alter_table("recurringrule", schema=None) as batch_op:
        batch_op.drop_column("account_id")
        batch_op.drop_column("counter_account_id")

    with op.batch_alter_table("recurringrule", schema=None) as batch_op:
        batch_op.create_foreign_key("recurringrule_from_account_id_fkey", "account", ["from_account_id"], ["id"])
        batch_op.create_foreign_key("recurringrule_to_account_id_fkey", "account", ["to_account_id"], ["id"])


def downgrade() -> None:  # pragma: no cover - downgrade path intentionally omitted
    raise NotImplementedError("downgrade not supported for unified account migration")
