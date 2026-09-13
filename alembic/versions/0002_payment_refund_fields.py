"""add payment.refunded_at

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-13

"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payments", sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("payments", "refunded_at")
