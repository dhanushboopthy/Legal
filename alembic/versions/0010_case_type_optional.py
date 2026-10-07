"""case type is optional

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-03

New cases no longer ask for a type. Existing values are kept.
"""
import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("cases", "case_type", existing_type=sa.String(100), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE cases SET case_type = '' WHERE case_type IS NULL")
    op.alter_column("cases", "case_type", existing_type=sa.String(100), nullable=False)
