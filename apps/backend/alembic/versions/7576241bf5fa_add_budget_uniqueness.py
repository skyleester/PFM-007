"""
Revision ID: 7576241bf5fa
Revises: e900bfd6243f
Create Date: 2025-09-27 18:24:05.602377
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '7576241bf5fa'
down_revision = 'e900bfd6243f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('budget', schema=None) as batch_op:
        batch_op.create_unique_constraint('uq_budget_span', ['user_id', 'category_id', 'period_start', 'period_end'])


def downgrade() -> None:
    with op.batch_alter_table('budget', schema=None) as batch_op:
        batch_op.drop_constraint('uq_budget_span', type_='unique')
