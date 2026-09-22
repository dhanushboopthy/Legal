"""case chat: messages, attachments, read cursors

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-21

See docs/NEW_FLOW_SPEC.md §7. `messages.id` is a bigint identity (a cursor the
client can page and poll by); `kind` is a plain string so new kinds need no
migration.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "messages",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("case_id", pg.UUID(as_uuid=True), sa.ForeignKey("cases.id"), nullable=False),
        sa.Column("sender_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("body", sa.Text, nullable=True),
        sa.Column("meta", pg.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("client_id", pg.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_messages_case_id_id", "messages", ["case_id", "id"])
    op.create_index(
        "uq_messages_sender_client_id", "messages", ["sender_id", "client_id"], unique=True,
        postgresql_where=sa.text("client_id IS NOT NULL"),
    )

    op.create_table(
        "message_attachments",
        sa.Column("message_id", sa.BigInteger, sa.ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("document_id", pg.UUID(as_uuid=True), sa.ForeignKey("case_documents.id"), primary_key=True),
    )

    op.create_table(
        "case_reads",
        sa.Column("case_id", pg.UUID(as_uuid=True), sa.ForeignKey("cases.id"), primary_key=True),
        sa.Column("user_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("last_read_message_id", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("last_emailed_message_id", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("last_emailed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("case_reads")
    op.drop_table("message_attachments")
    op.drop_index("uq_messages_sender_client_id", table_name="messages")
    op.drop_index("ix_messages_case_id_id", table_name="messages")
    op.drop_table("messages")
