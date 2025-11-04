"""
Add AccountV2 table

Revision ID: a1b2c3d4e5f6
Revises: 420508eb3eb3
Create Date: 2025-11-04 15:05:00
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '420508eb3eb3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum for AccountKind (on SQLite this will be a CHECK-constrained TEXT)
    accountkind = sa.Enum(
        'BANK', 'CARD', 'POINT', 'STOCK', 'PENSION', 'LOAN', 'CASH', 'VIRTUAL',
        name='accountkind'
    )
    accountkind.create(op.get_bind(), checkfirst=True)

    # Create account_v2 table
    op.create_table(
        'account_v2',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('type', accountkind, nullable=False),
        sa.Column('provider', sa.String(length=120), nullable=True),
        sa.Column('balance', sa.Numeric(18, 4), nullable=True),
        sa.Column('currency', sa.String(length=3), nullable=False, server_default='KRW'),
        sa.Column('parent_id', sa.Integer(), sa.ForeignKey('account_v2.id', ondelete='SET NULL'), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('metadata', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.CheckConstraint('parent_id IS NULL OR parent_id != id', name='ck_accountv2_parent_not_self'),
    )


def downgrade() -> None:
    op.drop_table('account_v2')
    # Drop enum if supported and no other dependencies (safe on non-SQLite)
    try:
        accountkind = sa.Enum(name='accountkind')
        accountkind.drop(op.get_bind(), checkfirst=True)
    except Exception:
        # SQLite or in-use enum; ignore
        pass
