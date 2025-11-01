"""add calendar events table

Revision ID: 4f15a3d7cb7d
Revises: 1189df8c6f4e
Create Date: 2025-10-10 09:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4f15a3d7cb7d"
down_revision: Union[str, None] = "1189df8c6f4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "calendarevent",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("type", sa.Enum("anniversary", "memo", "reminder", name="calendareventtype"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.String(length=9), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ),
    )
    op.create_index("ix_calendar_event_user_date", "calendarevent", ["user_id", "date"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_calendar_event_user_date", table_name="calendarevent")
    op.drop_table("calendarevent")
