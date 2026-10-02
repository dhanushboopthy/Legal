import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.payment import OfflineMethod, PaymentStatus, PaymentType


class PaymentOrderRequest(BaseModel):
    case_id: uuid.UUID


class PaymentOrderResponse(BaseModel):
    payment_id: uuid.UUID
    razorpay_order_id: str
    razorpay_key_id: str
    amount_paise: int
    currency: str = "INR"


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_id: uuid.UUID
    type: PaymentType
    amount: float
    currency: str
    status: PaymentStatus
    quote_id: uuid.UUID | None = None
    paid_at: datetime | None
    # "razorpay", or "offline" with the method (and any reference) the
    # advocate recorded.
    gateway: str = "razorpay"
    method: OfflineMethod | None = None
    reference: str | None = None


class OfflinePaymentCreate(BaseModel):
    """The advocate received the drafting charges outside Razorpay. There is
    no amount: it is always the open quote's."""

    method: OfflineMethod
    # A UPI transaction id, cheque number, receipt number... optional.
    reference: str | None = Field(default=None, max_length=150)

    @field_validator("reference")
    @classmethod
    def _blank_reference_is_none(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        return value or None


class PaymentListItem(PaymentOut):
    """A row in the admin payments table: which case and whose it is."""

    case_number: str | None = None
    case_title: str = ""
    junior_lawyer_name: str = ""
