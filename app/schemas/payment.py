import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.payment import PaymentStatus, PaymentType


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
