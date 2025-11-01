"""
Merge heads 70436ffa40dd and c9f01b2d3e45

This merge unifies two independent heads into a single linear history.
"""

from alembic import op  # noqa: F401

# revision identifiers, used by Alembic.
revision = "a7e3210f3b9c"
down_revision = ("70436ffa40dd", "c9f01b2d3e45")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Pure merge migration: no-op
    pass


def downgrade() -> None:
    # Cannot automatically unmerge branches
    pass
