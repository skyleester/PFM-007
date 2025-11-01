"""Add recurring occurrence drafts table and YEARLY frequency

Revision ID: bb7f34c5d6c2
Revises: ('4f15a3d7cb7d', '7b3a92d6d3a4')
Create Date: 2025-10-11 12:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "bb7f34c5d6c2"
down_revision: tuple[str, str] = ("4f15a3d7cb7d", "7b3a92d6d3a4")
branch_labels = None
depends_on = None


_old_frequency = sa.Enum("DAILY", "WEEKLY", "MONTHLY", name="recurringfrequency")
_new_frequency = sa.Enum("DAILY", "WEEKLY", "MONTHLY", "YEARLY", name="recurringfrequency")


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.execute(sa.text("ALTER TYPE recurringfrequency ADD VALUE IF NOT EXISTS 'YEARLY'"))
    else:
        with op.batch_alter_table("recurringrule", schema=None) as batch_op:
            batch_op.alter_column(
                "frequency",
                existing_type=_old_frequency,
                type_=_new_frequency,
                existing_nullable=False,
            )

    op.create_table(
        "recurringoccurrencedraft",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rule_id", sa.Integer(), sa.ForeignKey("recurringrule.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("occurred_at", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("rule_id", "occurred_at", name="uq_recurring_draft_rule_date"),
    )
    op.create_index(
        "ix_recurring_draft_user_date",
        "recurringoccurrencedraft",
        ["user_id", "occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_recurring_draft_user_date", table_name="recurringoccurrencedraft")
    op.drop_table("recurringoccurrencedraft")

    bind = op.get_bind()
    dialect = bind.dialect.name

    op.execute(sa.text("UPDATE recurringrule SET frequency = 'MONTHLY' WHERE frequency = 'YEARLY'"))

    if dialect == "postgresql":
        op.execute(sa.text("ALTER TABLE recurringrule ALTER COLUMN frequency TYPE TEXT"))
        op.execute(sa.text("DROP TYPE IF EXISTS recurringfrequency"))
        op.execute(sa.text("CREATE TYPE recurringfrequency AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY')"))
        op.execute(sa.text("ALTER TABLE recurringrule ALTER COLUMN frequency TYPE recurringfrequency USING frequency::recurringfrequency"))
    else:
        with op.batch_alter_table("recurringrule", schema=None) as batch_op:
            batch_op.alter_column(
                "frequency",
                existing_type=_new_frequency,
                type_=_old_frequency,
                existing_nullable=False,
            )
