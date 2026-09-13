"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-01-01

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(50), nullable=False, unique=True),
        sa.Column("permissions", pg.ARRAY(sa.String()), nullable=False, server_default="{}"),
    )

    op.create_table(
        "users",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("full_name", sa.String(150), nullable=False),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("bar_council_id", sa.String(100), nullable=True),
        sa.Column("role_id", pg.UUID(as_uuid=True), sa.ForeignKey("roles.id"), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_verified", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # Create each enum TYPE exactly once here (checkfirst=True, idempotent).
    # The column definitions below use create_type=False copies of the same
    # named type so that op.create_table doesn't also try to create them —
    # doing both raises DuplicateObjectError on Postgres.
    bind = op.get_bind()

    case_status_values = (
        "submitted", "review_fee_paid", "under_review", "rejected", "accepted",
        "drafting_fee_paid", "drafting", "draft_delivered", "revision_requested",
        "approved", "completed",
    )
    document_type_values = ("original", "draft", "final")
    payment_type_values = ("review", "drafting", "revision")
    payment_status_values = ("pending", "paid", "failed", "refunded")
    revision_status_values = ("pending", "resolved")

    pg.ENUM(*case_status_values, name="case_status").create(bind, checkfirst=True)
    pg.ENUM(*document_type_values, name="document_type").create(bind, checkfirst=True)
    pg.ENUM(*payment_type_values, name="payment_type").create(bind, checkfirst=True)
    pg.ENUM(*payment_status_values, name="payment_status").create(bind, checkfirst=True)
    pg.ENUM(*revision_status_values, name="revision_status").create(bind, checkfirst=True)

    case_status = pg.ENUM(*case_status_values, name="case_status", create_type=False)
    document_type = pg.ENUM(*document_type_values, name="document_type", create_type=False)
    payment_type = pg.ENUM(*payment_type_values, name="payment_type", create_type=False)
    payment_status = pg.ENUM(*payment_status_values, name="payment_status", create_type=False)
    revision_status = pg.ENUM(*revision_status_values, name="revision_status", create_type=False)

    op.create_table(
        "cases",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("junior_lawyer_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("case_type", sa.String(100), nullable=False),
        sa.Column("court", sa.String(150), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("status", case_status, nullable=False, server_default="submitted"),
        sa.Column("rejection_reason", sa.Text, nullable=True),
        sa.Column("revision_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_cases_status", "cases", ["status"])

    op.create_table(
        "case_documents",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("case_id", pg.UUID(as_uuid=True), sa.ForeignKey("cases.id"), nullable=False),
        sa.Column("type", document_type, nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("uploaded_by", pg.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "payments",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("case_id", pg.UUID(as_uuid=True), sa.ForeignKey("cases.id"), nullable=False),
        sa.Column("type", payment_type, nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("status", payment_status, nullable=False, server_default="pending"),
        sa.Column("gateway", sa.String(50), nullable=False, server_default="razorpay"),
        sa.Column("gateway_order_id", sa.String(150), nullable=True),
        sa.Column("gateway_payment_id", sa.String(150), nullable=True),
        sa.Column("gateway_signature", sa.String(255), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_payments_gateway_order_id", "payments", ["gateway_order_id"])

    op.create_table(
        "revision_requests",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("case_id", pg.UUID(as_uuid=True), sa.ForeignKey("cases.id"), nullable=False),
        sa.Column("requested_by", pg.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("status", revision_status, nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "notifications",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("message", sa.String(500), nullable=False),
        sa.Column("is_read", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", sa.String(100), nullable=False),
        sa.Column("log_metadata", sa.JSON, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("notifications")
    op.drop_table("revision_requests")
    op.drop_table("payments")
    op.drop_table("case_documents")
    op.drop_table("cases")
    op.drop_table("users")
    op.drop_table("roles")

    bind = op.get_bind()
    for enum_name in ("case_status", "document_type", "payment_type", "payment_status", "revision_status"):
        pg.ENUM(name=enum_name).drop(bind, checkfirst=True)
