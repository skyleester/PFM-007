"""
Make categories and groups global (remove per-user scoping)

- Deduplicate CategoryGroup by (type, code_gg)
- Remap Category.group_id to canonical groups
- Deduplicate Category by full_code
- Remap FKs in transaction/budget/recurringrule to canonical categories
- Drop user_id from categorygroup/category
- Recreate uniques for global scope
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '7576241bf5fa'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # 1) Canonicalize groups by (type, code_gg)
    conn.execute(text(
        """
        CREATE TEMPORARY TABLE tmp_group_canonical (
            type TEXT NOT NULL,
            code_gg INTEGER NOT NULL,
            canonical_id INTEGER NOT NULL
        )
        """
    ))
    conn.execute(text(
        """
        INSERT INTO tmp_group_canonical(type, code_gg, canonical_id)
        SELECT type, code_gg, MIN(id) AS canonical_id
        FROM categorygroup
        GROUP BY type, code_gg
        """
    ))

    # Remap categories.group_id to canonical
    conn.execute(text(
        """
        UPDATE category
        SET group_id = (
            SELECT t.canonical_id
            FROM categorygroup AS g
            JOIN tmp_group_canonical AS t
              ON g.type = t.type AND g.code_gg = t.code_gg
            WHERE g.id = category.group_id
        )
        WHERE EXISTS (
            SELECT 1
            FROM categorygroup AS g
            JOIN tmp_group_canonical AS t
              ON g.type = t.type AND g.code_gg = t.code_gg
            WHERE g.id = category.group_id AND t.canonical_id != category.group_id
        )
        """
    ))

    # Remove duplicate groups (keep canonicals)
    conn.execute(text(
        """
        DELETE FROM categorygroup
        WHERE id NOT IN (SELECT canonical_id FROM tmp_group_canonical)
        """
    ))
    conn.execute(text("DROP TABLE tmp_group_canonical"))

    # 2) Canonicalize categories by full_code
    conn.execute(text(
        """
        CREATE TEMPORARY TABLE tmp_cat_canonical (
            full_code TEXT NOT NULL,
            canonical_id INTEGER NOT NULL
        )
        """
    ))
    conn.execute(text(
        """
        INSERT INTO tmp_cat_canonical(full_code, canonical_id)
        SELECT full_code, MIN(id) AS canonical_id
        FROM category
        GROUP BY full_code
        """
    ))

    # Remap FKs: transaction, budget, recurringrule
    conn.execute(text(
        """
        UPDATE "transaction"
        SET category_id = (
            SELECT m.canonical_id
            FROM category AS c
            JOIN tmp_cat_canonical AS m ON c.full_code = m.full_code
            WHERE "transaction".category_id = c.id
        )
        WHERE EXISTS (
            SELECT 1
            FROM category AS c
            JOIN tmp_cat_canonical AS m ON c.full_code = m.full_code
            WHERE "transaction".category_id = c.id AND c.id != m.canonical_id
        )
        """
    ))
    conn.execute(text(
        """
        UPDATE budget
        SET category_id = (
            SELECT m.canonical_id
            FROM category AS c
            JOIN tmp_cat_canonical AS m ON c.full_code = m.full_code
            WHERE budget.category_id = c.id
        )
        WHERE EXISTS (
            SELECT 1
            FROM category AS c
            JOIN tmp_cat_canonical AS m ON c.full_code = m.full_code
            WHERE budget.category_id = c.id AND c.id != m.canonical_id
        )
        """
    ))
    conn.execute(text(
        """
        UPDATE recurringrule
        SET category_id = (
            SELECT m.canonical_id
            FROM category AS c
            JOIN tmp_cat_canonical AS m ON c.full_code = m.full_code
            WHERE recurringrule.category_id = c.id
        )
        WHERE EXISTS (
            SELECT 1
            FROM category AS c
            JOIN tmp_cat_canonical AS m ON c.full_code = m.full_code
            WHERE recurringrule.category_id = c.id AND c.id != m.canonical_id
        )
        """
    ))

    # Remove duplicate categories (keep canonicals)
    conn.execute(text(
        """
        DELETE FROM category
        WHERE id NOT IN (SELECT canonical_id FROM tmp_cat_canonical)
        """
    ))
    conn.execute(text("DROP TABLE tmp_cat_canonical"))

    # 3) Drop per-user uniques and columns, recreate globals
    # categorygroup
    with op.batch_alter_table('categorygroup') as batch:
        try:
            batch.drop_constraint('uq_group_code', type_='unique')
        except Exception:
            pass
        # Drop user_id column (if exists)
        cols = [c['name'] for c in inspector.get_columns('categorygroup')]
        if 'user_id' in cols:
            batch.drop_column('user_id')
        batch.create_unique_constraint('uq_group_code', ['type', 'code_gg'])

    # category
    with op.batch_alter_table('category') as batch:
        for cname in ('uq_category_full_code', 'uq_category_cc'):
            try:
                batch.drop_constraint(cname, type_='unique')
            except Exception:
                pass
        cols = [c['name'] for c in inspector.get_columns('category')]
        if 'user_id' in cols:
            batch.drop_column('user_id')
        batch.create_unique_constraint('uq_category_cc', ['group_id', 'code_cc'])
        batch.create_unique_constraint('uq_category_full_code', ['full_code'])


def downgrade() -> None:
    # Best-effort: reverse unique constraints and re-add user_id columns as nullable
    with op.batch_alter_table('categorygroup') as batch:
        try:
            batch.drop_constraint('uq_group_code', type_='unique')
        except Exception:
            pass
        batch.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        batch.create_unique_constraint('uq_group_code', ['user_id', 'type', 'code_gg'])

    with op.batch_alter_table('category') as batch:
        for cname in ('uq_category_full_code', 'uq_category_cc'):
            try:
                batch.drop_constraint(cname, type_='unique')
            except Exception:
                pass
        batch.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        batch.create_unique_constraint('uq_category_cc', ['user_id', 'group_id', 'code_cc'])
        batch.create_unique_constraint('uq_category_full_code', ['user_id', 'full_code'])
