"""add recurring occurrence skip table

Revision ID: c1a2b3d4e5f6
Revises: merge_20251021_unify_heads
Create Date: 2025-10-21
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c1a2b3d4e5f6'
down_revision = 'a7e3210f3b9c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'recurringoccurrenceskip',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('rule_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('occurred_at', sa.Date(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['rule_id'], ['recurringrule.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('rule_id', 'occurred_at', name='uq_recurring_skip_rule_date'),
    )
    op.create_index('ix_recurring_skip_user_date', 'recurringoccurrenceskip', ['user_id', 'occurred_at'])


def downgrade() -> None:
    op.drop_index('ix_recurring_skip_user_date', table_name='recurringoccurrenceskip')
    op.drop_table('recurringoccurrenceskip')
