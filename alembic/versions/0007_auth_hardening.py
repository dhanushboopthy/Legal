"""auth hardening: revocable refresh tokens, lockout, password-reset codes

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-27

`refresh_tokens` records every refresh token issued (by `jti`) so logout and a
password reset can revoke them, and a replayed (already rotated) token revokes
its whole family. Refresh tokens issued before this migration carry no `jti`
and are refused, so everyone signs in once more after deploying it.

`users.failed_login_count` / `locked_until` pause password sign-in after
repeated wrong passwords. `email_otps.purpose` separates an email-verification
code from a password-reset code, so asking for one doesn't cancel the other.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "refresh_tokens",
        sa.Column("jti", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id", pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("family_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replaced_by", pg.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_family_id", "refresh_tokens", ["family_id"])

    op.add_column(
        "users", sa.Column("failed_login_count", sa.Integer, nullable=False, server_default="0")
    )
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))

    op.add_column(
        "email_otps",
        sa.Column("purpose", sa.String(20), nullable=False, server_default="verify_email"),
    )


def downgrade() -> None:
    op.drop_column("email_otps", "purpose")
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_login_count")
    op.drop_index("ix_refresh_tokens_family_id", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
