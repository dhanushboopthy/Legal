"""held-over cases and profile pictures

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-28

`case_status` gains `held_over`: the advocate pauses a case that is waiting on
them and resumes it to `cases.held_from`, with `cases.hold_reason` shown to
the lawyer. The new `case:hold` permission is granted by `scripts.seed_roles`
(re-run it after this migration).

`users.avatar_key` points at a profile picture under `avatars/{user_id}/`.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ADD VALUE cannot run inside a transaction block.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'held_over'")

    op.add_column("cases", sa.Column("hold_reason", sa.Text, nullable=True))
    op.add_column(
        "cases",
        sa.Column("held_from", pg.ENUM(name="case_status", create_type=False), nullable=True),
    )
    op.add_column("users", sa.Column("avatar_key", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_key")
    op.drop_column("cases", "held_from")
    op.drop_column("cases", "hold_reason")
    # Postgres cannot drop an enum value; 'held_over' stays in case_status.
