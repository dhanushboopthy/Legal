import hashlib
import hmac
import uuid
from datetime import datetime, timezone

import razorpay
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.models.case import Case, CaseStatus
from app.models.payment import Payment, PaymentStatus, PaymentType
from app.services import audit_service, case_service, notification_service

_FEE_FOR_TYPE = {
    PaymentType.REVIEW: lambda: settings.review_fee_inr,
    PaymentType.DRAFTING: lambda: settings.drafting_fee_inr,
    PaymentType.REVISION: lambda: settings.revision_fee_inr,
}

# The case status a payment type is only payable from.
_PAYABLE_FROM_STATUS = {
    PaymentType.REVIEW: CaseStatus.SUBMITTED,
    PaymentType.DRAFTING: CaseStatus.ACCEPTED,
    PaymentType.REVISION: CaseStatus.DRAFT_DELIVERED,
}

# What each payment type unlocks once confirmed paid.
_STATUS_AFTER_PAYMENT = {
    PaymentType.REVIEW: CaseStatus.REVIEW_FEE_PAID,
    PaymentType.DRAFTING: CaseStatus.DRAFTING_FEE_PAID,
    PaymentType.REVISION: CaseStatus.REVISION_REQUESTED,
}


def _razorpay_client() -> razorpay.Client:
    return razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))


async def create_order(
    db: AsyncSession, *, case: Case, payment_type: PaymentType,
) -> tuple[Payment, dict]:
    expected_status = _PAYABLE_FROM_STATUS[payment_type]
    if case.status != expected_status:
        raise ConflictError(
            f"A {payment_type.value} payment can only be created while the case is "
            f"'{expected_status.value}' (current: '{case.status.value}')"
        )

    amount_inr = _FEE_FOR_TYPE[payment_type]()
    amount_paise = int(amount_inr * 100)

    client = _razorpay_client()
    order = client.order.create(
        {
            "amount": amount_paise,
            "currency": "INR",
            "notes": {"case_id": str(case.id), "payment_type": payment_type.value},
        }
    )

    payment = Payment(
        case_id=case.id,
        type=payment_type,
        amount=amount_inr,
        currency="INR",
        status=PaymentStatus.PENDING,
        gateway="razorpay",
        gateway_order_id=order["id"],
    )
    db.add(payment)
    await db.flush()

    await audit_service.log_action(
        db, user_id=case.junior_lawyer_id, action="payment.order_created",
        entity_type="payment", entity_id=str(payment.id),
        metadata={"type": payment_type.value, "amount_inr": amount_inr},
    )
    return payment, order


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    expected = hmac.new(
        settings.razorpay_webhook_secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


async def handle_payment_captured(db: AsyncSession, *, gateway_order_id: str, gateway_payment_id: str) -> Payment:
    result = await db.execute(
        select(Payment).where(Payment.gateway_order_id == gateway_order_id)
    )
    payment = result.scalar_one_or_none()
    if payment is None:
        raise NotFoundError(f"No payment found for order {gateway_order_id}")

    if payment.status == PaymentStatus.PAID:
        # Webhook redelivery — idempotent no-op.
        return payment

    payment.status = PaymentStatus.PAID
    payment.gateway_payment_id = gateway_payment_id
    payment.paid_at = datetime.now(timezone.utc)

    case = await case_service.get_case_or_404(db, payment.case_id)
    case.status = _STATUS_AFTER_PAYMENT[payment.type]
    if payment.type == PaymentType.REVISION:
        case.revision_count += 1

    await audit_service.log_action(
        db, user_id=None, action="payment.captured",
        entity_type="payment", entity_id=str(payment.id),
        metadata={"gateway_payment_id": gateway_payment_id},
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id,
        message=f"Payment of Rs.{payment.amount} received. Your case is progressing.",
    )
    return payment
