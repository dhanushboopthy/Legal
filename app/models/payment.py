import enum
import uuid

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class PaymentType(str, enum.Enum):
    REVIEW = "review"
    DRAFTING = "drafting"
    REVISION = "revision"


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"


class Payment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "payments"

    case_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False
    )
    case: Mapped["Case"] = relationship(back_populates="payments")

    type: Mapped[PaymentType] = mapped_column(
        Enum(PaymentType, name="payment_type", values_callable=lambda e: [m.value for m in e])
    )
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    status: Mapped[PaymentStatus] = mapped_column(
        Enum(PaymentStatus, name="payment_status", values_callable=lambda e: [m.value for m in e]),
        default=PaymentStatus.PENDING,
    )

    gateway: Mapped[str] = mapped_column(String(50), default="razorpay")
    gateway_order_id: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(150), nullable=True)
    gateway_signature: Mapped[str | None] = mapped_column(String(255), nullable=True)

    paid_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
