"""phase 5 onboarding: case numbers, pending-approval reminders

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-22

Human-readable case numbers (docs/UX_REDESIGN_PLAN.md 5.5): a global sequence
backs `LF-{year}-{seq:04d}`, computed and stored at case-creation time (not
derived on read) so it stays stable and searchable. The column is nullable at
the DB level — app.services.case_service.create_case always sets it, but
letting it be nullable avoids forcing every direct-insert test fixture to
supply one.

`users.pending_reminder_sent_at` backs the bounded admin-approval gate: a
worker sweep reminds USER_MANAGE holders about pending accounts older than
`pending_approval_reminder_after_hours`, and this column stops the same
account being renagged every sweep.
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE case_number_seq")
    op.add_column("cases", sa.Column("case_number", sa.String(20), nullable=True))
    op.execute(
        "UPDATE cases SET case_number = "
        "'LF-' || extract(year from created_at) || '-' || lpad(nextval('case_number_seq')::text, 4, '0')"
    )
    op.create_index("ix_cases_case_number", "cases", ["case_number"], unique=True)

    op.add_column(
        "users", sa.Column("pending_reminder_sent_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "pending_reminder_sent_at")
    op.drop_index("ix_cases_case_number", table_name="cases")
    op.drop_column("cases", "case_number")
    op.execute("DROP SEQUENCE case_number_seq")
