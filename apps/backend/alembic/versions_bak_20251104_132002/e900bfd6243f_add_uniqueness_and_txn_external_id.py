"""
Revision ID: e900bfd6243f
Revises: e2cdd209771f
Create Date: 2025-09-27 18:01:54.996087
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e900bfd6243f'
down_revision = 'e2cdd209771f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite 호환: batch_alter_table 사용
    with op.batch_alter_table('account', schema=None) as batch_op:
        batch_op.create_unique_constraint('uq_account_name', ['user_id', 'name'])

    with op.batch_alter_table('payee', schema=None) as batch_op:
        batch_op.create_unique_constraint('uq_payee_name', ['user_id', 'name'])

    with op.batch_alter_table('transaction', schema=None) as batch_op:
        batch_op.add_column(sa.Column('external_id', sa.String(length=64), nullable=True))
        batch_op.create_unique_constraint('uq_txn_external_id', ['user_id', 'external_id'])


def downgrade() -> None:
    with op.batch_alter_table('transaction', schema=None) as batch_op:
        batch_op.drop_constraint('uq_txn_external_id', type_='unique')
        batch_op.drop_column('external_id')

    with op.batch_alter_table('payee', schema=None) as batch_op:
        batch_op.drop_constraint('uq_payee_name', type_='unique')

    with op.batch_alter_table('account', schema=None) as batch_op:
        batch_op.drop_constraint('uq_account_name', type_='unique')
