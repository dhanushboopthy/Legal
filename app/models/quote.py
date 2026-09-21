import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class QuoteStatus(str, enum.Enum):
    OPEN = "open"              # sent, waiting for the junior to pay
    PAID = "paid"              # payment confirmed by webhook; download unlocked
    SUPERSEDED = "superseded"  # the advocate replaced it before it was paid
    REFUNDED = "refunded"      # paid, then refunded; download access revoked


class Quote(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """The price the advocate puts on one case's draft. A case can have several
    over time (each replacement is a new version), but only one is ever open.
    The amount is stored in paise and is the only source for the Razorpay
    order amount — the client never supplies it."""

    __tablename__ = "quotes"
    __table_args__ = (
        UniqueConstraint("case_id", "version", name="uq_quotes_case_version"),
        Index(
            "uq_quotes_one_open_per_case", "case_id", unique=True,
            postgresql_where=text("status = 'open'"),
        ),
    )

    case_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False, index=True
    )
    case: Mapped["Case"] = relationship(back_populates="quotes")

    version: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    draft_document_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("case_documents.id"), nullable=False
    )
    status: Mapped[QuoteStatus] = mapped_column(
        Enum(QuoteStatus, name="quote_status", values_callable=lambda e: [m.value for m in e]),
        default=QuoteStatus.OPEN,
    )

    created_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def amount_inr(self) -> int:
        return self.amount_paise // 100
