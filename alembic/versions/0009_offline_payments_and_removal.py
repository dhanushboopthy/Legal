"""offline payments and removing people

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-01

`payments` gains `method`, `reference` and `recorded_by` for drafting charges
the advocate marks as received outside Razorpay (`gateway = 'offline'`). The
new `payment:record_offline` permission is granted by `scripts.seed_roles`
(re-run it after this migration).

`users.removed_at` marks a person an admin has removed from the service,
apart from an account still waiting for approval.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("method", sa.String(30), nullable=True))
    op.add_column("payments", sa.Column("reference", sa.String(150), nullable=True))
    op.add_column(
        "payments",
        sa.Column("recorded_by", pg.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.add_column("users", sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "removed_at")
    op.drop_column("payments", "recorded_by")
    op.drop_column("payments", "reference")
    op.drop_column("payments", "method")
