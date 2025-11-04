"""Ensure account metadata and balance columns align with unified model

Revision ID: 20251103_account_metadata_guard
Revises: 20251103_unified_accounts
Create Date: 2025-11-03 12:30:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20251103_account_metadata_guard"
down_revision: Union[str, Sequence[str], None] = "20251103_unified_accounts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ensure_column(
    inspector: sa.engine.reflection.Inspector,
    column_name: str,
    column: sa.Column,
) -> bool:
    if column_name in {c["name"] for c in inspector.get_columns("account")}:
        return False
    with op.batch_alter_table("account", schema=None) as batch_op:
        batch_op.add_column(column)
    return True


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None
    inspector = sa.inspect(bind)

    added_current_balance = _ensure_column(
        inspector,
        "current_balance",
        sa.Column("current_balance", sa.Numeric(18, 4), nullable=False, server_default="0"),
    )
    inspector = sa.inspect(bind)

    if added_current_balance:
        legacy_cols = {c["name"] for c in inspector.get_columns("account")}
        if "balance" in legacy_cols:
            op.execute("UPDATE account SET current_balance = COALESCE(balance, 0)")
        op.alter_column("account", "current_balance", server_default=None)

    op.execute("UPDATE account SET current_balance = 0 WHERE current_balance IS NULL")

    added_is_active = _ensure_column(
        inspector,
        "is_active",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    inspector = sa.inspect(bind)

    if added_is_active:
        legacy_cols = {c["name"] for c in inspector.get_columns("account")}
        if "is_archived" in legacy_cols:
            if dialect == "sqlite":
                op.execute(
                    "UPDATE account SET is_active = CASE WHEN is_archived = 1 THEN 0 ELSE 1 END"
                )
            else:
                op.execute(
                    "UPDATE account SET is_active = CASE WHEN is_archived THEN FALSE ELSE TRUE END"
                )
        else:
            op.execute("UPDATE account SET is_active = 1 WHERE is_active IS NULL")
        op.alter_column("account", "is_active", server_default=None)

    op.execute(
        "UPDATE account SET is_active = 1 WHERE is_active IS NULL"
    )

    added_extra_metadata = _ensure_column(
        inspector,
        "extra_metadata",
        sa.Column(
            "extra_metadata",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'") if dialect == "sqlite" else sa.text("'{}'::jsonb"),
        ),
    )
    if added_extra_metadata:
        op.alter_column("account", "extra_metadata", server_default=None)

    if dialect == "sqlite":
        op.execute("UPDATE account SET extra_metadata = COALESCE(extra_metadata, json_object())")
    else:
        op.execute("UPDATE account SET extra_metadata = COALESCE(extra_metadata, '{}'::jsonb)")

    if dialect == "sqlite":
        op.execute(
            """
            UPDATE account
            SET extra_metadata = json_set(
                COALESCE(extra_metadata, json_object()),
                '$.auto_deduct',
                json('false')
            )
            WHERE type IN ('CHECK_CARD', 'CREDIT_CARD')
              AND json_type(extra_metadata, '$.auto_deduct') IS NULL
            """
        )
    else:
        op.execute(
            """
            UPDATE account
            SET extra_metadata = jsonb_set(
                COALESCE(extra_metadata, '{}'::jsonb),
                '{auto_deduct}',
                'false'::jsonb,
                true
            )
            WHERE type IN ('CHECK_CARD', 'CREDIT_CARD')
              AND (extra_metadata->>'auto_deduct') IS NULL
            """
        )


def downgrade() -> None:  # pragma: no cover - irreversible structural migration
    raise NotImplementedError("Downgrade not supported for account metadata guard migration")
