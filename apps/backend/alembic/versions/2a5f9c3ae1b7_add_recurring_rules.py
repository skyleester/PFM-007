"""
Revision ID: 2a5f9c3ae1b7
Revises: 7576241bf5fa
Create Date: 2025-09-27 19:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2a5f9c3ae1b7'
down_revision = '7576241bf5fa'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'recurringrule',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('type', sa.Enum('INCOME', 'EXPENSE', 'TRANSFER', name='txntype'), nullable=False),
        sa.Column('frequency', sa.Enum('DAILY', 'WEEKLY', 'MONTHLY', name='recurringfrequency'), nullable=False),
        sa.Column('day_of_month', sa.Integer(), nullable=True),
        sa.Column('weekday', sa.Integer(), nullable=True),
        sa.Column('amount', sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('counter_account_id', sa.Integer(), nullable=True),
        sa.Column('category_id', sa.Integer(), nullable=True),
        sa.Column('memo', sa.Text(), nullable=True),
        sa.Column('payee_id', sa.Integer(), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('last_generated_at', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['account_id'], ['account.id'], ),
        sa.ForeignKeyConstraint(['category_id'], ['category.id'], ),
        sa.ForeignKeyConstraint(['counter_account_id'], ['account.id'], ),
        sa.ForeignKeyConstraint(['payee_id'], ['payee.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'name', name='uq_recurring_name'),
        sa.CheckConstraint("(type = 'TRANSFER' AND counter_account_id IS NOT NULL AND category_id IS NULL) OR (type IN ('INCOME','EXPENSE'))", name='ck_recurring_type_rules'),
    )


def downgrade() -> None:
    op.drop_table('recurringrule')
