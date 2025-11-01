"""Add statistics presets table

Revision ID: 4a7b0bbbc6d1
Revises: d8f2c1f0b123
Create Date: 2025-10-14 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4a7b0bbbc6d1"
down_revision: Union[str, Sequence[str], None] = "d8f2c1f0b123"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "statisticspreset",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("selected_category_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "name", name="uq_statistics_preset_user_name"),
    )
    op.create_index("ix_statistics_preset_user", "statisticspreset", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_statistics_preset_user", table_name="statisticspreset")
    op.drop_table("statisticspreset")
