import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Identity, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MessageKind(str, enum.Enum):
    TEXT = "text"
    FILE = "file"      # a message with attachments (and maybe text)
    SYSTEM = "system"  # an event line the server wrote ("Payment received")
    QUOTE = "quote"    # the draft-and-price card
    DRAFT = "draft"    # a new draft version card


class Message(Base):
    """One entry in a case's chat. `id` counts up across the whole table, and a
    case's messages are written under a per-case lock, so within a case a larger
    id is always a later, already-visible message: clients can ask for "after id N"
    without missing one."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    case_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    # Null for messages the server wrote on its own (a payment webhook).
    sender_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    # A plain string rather than a Postgres enum: a new kind then needs no migration.
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    # Made by the browser for each send so a retry can't post twice.
    client_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_messages_case_id_id", "case_id", "id"),
        Index(
            "uq_messages_sender_client_id", "sender_id", "client_id", unique=True,
            postgresql_where=text("client_id IS NOT NULL"),
        ),
    )


class MessageAttachment(Base):
    __tablename__ = "message_attachments"

    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("case_documents.id"), primary_key=True
    )


class CaseRead(Base):
    """How far each participant has read a case's chat, and the last time they
    were emailed about unread messages (so a long-unread thread isn't emailed
    every few minutes)."""

    __tablename__ = "case_reads"

    case_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("cases.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    last_read_message_id: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    last_emailed_message_id: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    last_emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
