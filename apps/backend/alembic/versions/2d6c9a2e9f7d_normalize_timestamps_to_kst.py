"""Normalize timestamp columns to Asia/Seoul baseline

Revision ID: 2d6c9a2e9f7d
Revises: f0c2b36a0e5d
Create Date: 2025-10-07 12:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "2d6c9a2e9f7d"
down_revision = "f0c2b36a0e5d"
branch_labels = None
depends_on = None


TABLES_WITH_TIMESTAMPS = [
    "user",
    "userprofile",
    "account",
    "categorygroup",
    "category",
    "transfergroup",
    "payee",
    "transaction",
    "budget",
    "tag",
    "recurringrule",
]


def upgrade() -> None:
    conn = op.get_bind()
    # SQLite datetime() helper handles NULL gracefully. Add +9 hours to convert stored UTC naive values to KST naive.
    for table in TABLES_WITH_TIMESTAMPS:
        conn.execute(sa.text(
            f'UPDATE "{table}" SET created_at = datetime(created_at, "+9 hours"), '
            f'updated_at = CASE WHEN updated_at IS NOT NULL THEN datetime(updated_at, "+9 hours") ELSE updated_at END'
        ))


def downgrade() -> None:
    conn = op.get_bind()
    for table in TABLES_WITH_TIMESTAMPS:
        conn.execute(sa.text(
            f'UPDATE "{table}" SET created_at = datetime(created_at, "-9 hours"), '
            f'updated_at = CASE WHEN updated_at IS NOT NULL THEN datetime(updated_at, "-9 hours") ELSE updated_at END'
        ))
