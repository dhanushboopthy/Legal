import enum
import uuid

from sqlalchemy import Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class CaseStatus(str, enum.Enum):
    """The case lifecycle, in the order a case normally moves through it. The
    allowed moves live in app.services.case_service.TRANSITIONS."""

    DRAFT = "draft"                          # junior is still adding files; not visible to the advocate
    SUBMITTED = "submitted"                  # awaiting the review fee
    REVIEW_FEE_PAID = "review_fee_paid"      # advocate must decide
    REJECTED = "rejected"
    ACCEPTED = "accepted"                    # advocate is preparing a draft and a price
    QUOTED = "quoted"                        # draft sent, locked until the junior pays the quote
    DELIVERED = "delivered"                  # quote paid, draft downloadable
    REVISION_REQUESTED = "revision_requested"
    COMPLETED = "completed"


class Case(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "cases"

    junior_lawyer_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    junior_lawyer: Mapped["User"] = relationship(back_populates="cases")

    # "LF-2026-0042": assigned once at creation from case_number_seq, never
    # recomputed. Nullable at the DB level only so a fixture that inserts a
    # Case directly doesn't need one; every real case gets one from
    # case_service.create_case.
    case_number: Mapped[str | None] = mapped_column(String(20), nullable=True, unique=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    case_type: Mapped[str] = mapped_column(String(100), nullable=False)
    court: Mapped[str | None] = mapped_column(String(150), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[CaseStatus] = mapped_column(
        Enum(CaseStatus, name="case_status", values_callable=lambda e: [m.value for m in e]),
        default=CaseStatus.SUBMITTED, index=True,
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    revision_count: Mapped[int] = mapped_column(Integer, default=0)

    documents: Mapped[list["CaseDocument"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
    quotes: Mapped[list["Quote"]] = relationship(
        back_populates="case", cascade="all, delete-orphan", order_by="Quote.version"
    )
