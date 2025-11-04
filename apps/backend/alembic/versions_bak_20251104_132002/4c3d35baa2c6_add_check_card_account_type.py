"""add check card account type and link

Revision ID: 4c3d35baa2c6
Revises: 1189df8c6f4e
Create Date: 2025-10-12 10:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4c3d35baa2c6"
down_revision: Union[str, None] = "1189df8c6f4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None
    if dialect == "postgresql":
        op.execute(sa.text("ALTER TYPE accounttype ADD VALUE IF NOT EXISTS 'CHECK_CARD'"))

    if dialect == "sqlite":
        with op.batch_alter_table("account", recreate="always") as batch_op:
            batch_op.add_column(sa.Column("linked_account_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_account_linked_account",
                "account",
                ["linked_account_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch_op.create_check_constraint(
                "ck_account_link_not_self",
                "linked_account_id IS NULL OR linked_account_id <> id",
            )
    else:
        op.add_column("account", sa.Column("linked_account_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_account_linked_account",
            "account",
            "account",
            ["linked_account_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_check_constraint(
            "ck_account_link_not_self",
            "account",
            "linked_account_id IS NULL OR linked_account_id <> id",
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else None

    if dialect == "sqlite":
        with op.batch_alter_table("account", recreate="always") as batch_op:
            batch_op.drop_constraint("fk_account_linked_account", type_="foreignkey")
            batch_op.drop_constraint("ck_account_link_not_self", type_="check")
            batch_op.drop_column("linked_account_id")
    else:
        op.drop_constraint("fk_account_linked_account", "account", type_="foreignkey")
        op.drop_constraint("ck_account_link_not_self", "account", type_="check")
        op.drop_column("account", "linked_account_id")
    # Enum values cannot be easily removed in PostgreSQL; leaving CHECK_CARD value in place on downgrade.
