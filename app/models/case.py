import enum
import uuid

from sqlalchemy import Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class CaseStatus(str, enum.Enum):
    SUBMITTED = "submitted"
    REVIEW_FEE_PAID = "review_fee_paid"
    UNDER_REVIEW = "under_review"
    REJECTED = "rejected"
    ACCEPTED = "accepted"
    DRAFTING_FEE_PAID = "drafting_fee_paid"
    DRAFTING = "drafting"
    DRAFT_DELIVERED = "draft_delivered"
    REVISION_REQUESTED = "revision_requested"
    APPROVED = "approved"
    COMPLETED = "completed"


class Case(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "cases"

    junior_lawyer_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    junior_lawyer: Mapped["User"] = relationship(back_populates="cases")

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    case_type: Mapped[str] = mapped_column(String(100), nullable=False)
    court: Mapped[str | None] = mapped_column(String(150), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

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
