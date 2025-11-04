"""Add statistics settings table

Revision ID: d8f2c1f0b123
Revises: bb7f34c5d6c2
Create Date: 2025-10-14 10:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d8f2c1f0b123"
down_revision: Union[str, Sequence[str], None] = "bb7f34c5d6c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "statisticssetting",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("excluded_category_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.UniqueConstraint("user_id", name="uq_statistics_setting_user"),
    )


def downgrade() -> None:
    op.drop_table("statisticssetting")
