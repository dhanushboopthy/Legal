import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Null for Google-only accounts (see google_sub) — they have no password.
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Google's stable per-user id ("sub" claim). Set on Google sign-in/link.
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)

    bar_council_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Profile picture: an object key under avatars/{user_id}/ (never served by
    # the api; the browser gets a presigned URL).
    avatar_key: Mapped[str | None] = mapped_column(String(255), nullable=True)

    role_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("roles.id"))
    role: Mapped["Role"] = relationship(back_populates="users")

    # Junior lawyers are inactive until the admin approves their account.
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    # Last time an admin was reminded this account is still waiting; None
    # until the first reminder. Only meaningful while is_active is False.
    pending_reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Set when an admin removes the person from the service (is_active is then
    # False too, but this is what tells "removed" apart from "waiting for
    # approval"). Cleared when they are restored. Their cases stay as they are.
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Password sign-in pauses until locked_until after too many wrong tries.
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    cases: Mapped[list["Case"]] = relationship(back_populates="junior_lawyer")
