"""quote-after-draft flow: new case statuses, quotes, document metadata

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-21

See docs/NEW_FLOW_SPEC.md §3 and §8. The five statuses of the old fixed-fee
flow (under_review, drafting, approved, drafting_fee_paid, draft_delivered)
and document type `final` are retired. Postgres cannot drop an enum value, so
those two types are recreated; `payment_type` only gains a value, so it keeps
its legacy `drafting` / `revision` members for old payment rows.

There is no data mapping: the app was not live when this was written. If any
row still uses a retired value the migration stops before changing anything —
clear a dev database with `python -m scripts.reset_dev_data --yes`.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

OLD_CASE_STATUSES = (
    "submitted", "review_fee_paid", "under_review", "rejected", "accepted",
    "drafting_fee_paid", "drafting", "draft_delivered", "revision_requested",
    "approved", "completed",
)
NEW_CASE_STATUSES = (
    "draft", "submitted", "review_fee_paid", "rejected", "accepted", "quoted",
    "delivered", "revision_requested", "completed",
)
RETIRED_CASE_STATUSES = ("under_review", "drafting", "approved", "drafting_fee_paid", "draft_delivered")

OLD_DOCUMENT_TYPES = ("original", "draft", "final")
NEW_DOCUMENT_TYPES = ("original", "supporting", "draft")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def _refuse_if_rows(table: str, column: str, values: tuple[str, ...]) -> None:
    count = op.get_bind().execute(
        sa.text(f"SELECT count(*) FROM {table} WHERE {column}::text IN ({_quoted(values)})")
    ).scalar_one()
    if count:
        raise RuntimeError(
            f"{count} row(s) in {table}.{column} still use a value this migration retires "
            f"({', '.join(values)}). This is a one-way change with no data mapping; on a "
            "dev database run `python -m scripts.reset_dev_data --yes` first."
        )


def _recreate_enum(
    name: str, values: tuple[str, ...], table: str, column: str,
    *, using: str | None = None, default: str | None = None,
) -> None:
    old = f"{name}_old"
    op.execute(f"ALTER TYPE {name} RENAME TO {old}")
    pg.ENUM(*values, name=name).create(op.get_bind(), checkfirst=False)
    if default is not None:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} DROP DEFAULT")
    op.execute(
        f"ALTER TABLE {table} ALTER COLUMN {column} TYPE {name} "
        f"USING ({using or f'{column}::text'})::{name}"
    )
    if default is not None:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} SET DEFAULT '{default}'")
    op.execute(f"DROP TYPE {old}")


def upgrade() -> None:
    _refuse_if_rows("cases", "status", RETIRED_CASE_STATUSES)
    _refuse_if_rows("case_documents", "type", ("final",))

    # ADD VALUE cannot run inside a transaction block, so it gets its own
    # autocommit block. IF NOT EXISTS makes a re-run after a later failure safe.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'quote'")

    _recreate_enum("case_status", NEW_CASE_STATUSES, "cases", "status", default="submitted")
    _recreate_enum("document_type", NEW_DOCUMENT_TYPES, "case_documents", "type")

    op.add_column("cases", sa.Column("note", sa.Text, nullable=True))

    op.add_column("case_documents", sa.Column("size_bytes", sa.BigInteger, nullable=True))
    op.add_column("case_documents", sa.Column("content_type", sa.String(100), nullable=True))
    op.add_column("case_documents", sa.Column("page_count", sa.Integer, nullable=True))

    pg.ENUM("open", "paid", "superseded", "refunded", name="quote_status").create(
        op.get_bind(), checkfirst=True
    )
    op.create_table(
        "quotes",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("case_id", pg.UUID(as_uuid=True), sa.ForeignKey("cases.id"), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("amount_paise", sa.Integer, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column(
            "draft_document_id", pg.UUID(as_uuid=True),
            sa.ForeignKey("case_documents.id"), nullable=False,
        ),
        sa.Column(
            "status", pg.ENUM(name="quote_status", create_type=False),
            nullable=False, server_default="open",
        ),
        sa.Column("created_by", pg.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("case_id", "version", name="uq_quotes_case_version"),
    )
    op.create_index("ix_quotes_case_id", "quotes", ["case_id"])
    # At most one open quote per case, enforced by the database, not just code.
    op.create_index(
        "uq_quotes_one_open_per_case", "quotes", ["case_id"], unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )

    op.add_column(
        "payments",
        sa.Column("quote_id", pg.UUID(as_uuid=True), sa.ForeignKey("quotes.id"), nullable=True),
    )
    op.create_index("ix_payments_quote_id", "payments", ["quote_id"])

    op.add_column(
        "notifications",
        sa.Column("case_id", pg.UUID(as_uuid=True), sa.ForeignKey("cases.id"), nullable=True),
    )
    op.add_column("notifications", sa.Column("kind", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("notifications", "kind")
    op.drop_column("notifications", "case_id")

    op.drop_index("ix_payments_quote_id", table_name="payments")
    op.drop_column("payments", "quote_id")

    op.drop_index("uq_quotes_one_open_per_case", table_name="quotes")
    op.drop_index("ix_quotes_case_id", table_name="quotes")
    op.drop_table("quotes")
    pg.ENUM(name="quote_status").drop(op.get_bind(), checkfirst=True)

    op.drop_column("case_documents", "page_count")
    op.drop_column("case_documents", "content_type")
    op.drop_column("case_documents", "size_bytes")
    op.drop_column("cases", "note")

    # Back to the old flow's nearest equivalents.
    _recreate_enum(
        "document_type", OLD_DOCUMENT_TYPES, "case_documents", "type",
        using="CASE WHEN type::text = 'supporting' THEN 'original' ELSE type::text END",
    )
    _recreate_enum(
        "case_status", OLD_CASE_STATUSES, "cases", "status", default="submitted",
        using=(
            "CASE status::text WHEN 'draft' THEN 'submitted' WHEN 'quoted' THEN 'accepted' "
            "WHEN 'delivered' THEN 'draft_delivered' ELSE status::text END"
        ),
    )
    # payment_type keeps 'quote': Postgres cannot drop an enum value, and the
    # old code simply never uses it.
