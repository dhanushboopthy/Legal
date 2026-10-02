import hashlib
import hmac
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import razorpay
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import ConflictError, NotFoundError
from app.core.money import format_inr, paise_from_rupees
from app.models.case import Case, CaseStatus
from app.models.message import MessageKind
from app.models.payment import OfflineMethod, Payment, PaymentStatus, PaymentType
from app.models.quote import Quote, QuoteStatus
from app.models.user import User
from app.schemas.payment import PaymentOrderResponse
from app.services import audit_service, case_service, message_service, notification_service

logger = structlog.get_logger()


def _razorpay_client() -> razorpay.Client:
    return razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))


def order_response(payment: Payment) -> PaymentOrderResponse:
    return PaymentOrderResponse(
        payment_id=payment.id,
        razorpay_order_id=payment.gateway_order_id,
        razorpay_key_id=settings.razorpay_key_id,
        amount_paise=paise_from_rupees(payment.amount),
        currency=payment.currency,
    )


async def _reusable_payment(
    db: AsyncSession, *, case_id: uuid.UUID, payment_type: PaymentType, quote_id: uuid.UUID | None,
) -> Payment | None:
    """An order that was created but never paid. Reusing it means clicking "Pay"
    twice, or reopening the page, never leaves two live orders for one thing
    (F-10). A FAILED payment is reusable too: Razorpay lets an order be retried
    after a failed attempt."""
    query = select(Payment).where(
        Payment.case_id == case_id,
        Payment.type == payment_type,
        Payment.status.in_([PaymentStatus.PENDING, PaymentStatus.FAILED]),
        Payment.quote_id == quote_id if quote_id else Payment.quote_id.is_(None),
    ).order_by(Payment.created_at.desc()).limit(1)
    return (await db.execute(query)).scalar_one_or_none()


async def _create_order(
    db: AsyncSession, *, case: Case, payment_type: PaymentType, amount_paise: int,
    quote: Quote | None = None,
) -> Payment:
    notes = {"case_id": str(case.id), "payment_type": payment_type.value}
    if quote is not None:
        notes.update(quote_id=str(quote.id), quote_version=str(quote.version))

    order = _razorpay_client().order.create(
        {"amount": amount_paise, "currency": "INR", "notes": notes}
    )
    payment = Payment(
        case_id=case.id, type=payment_type, amount=Decimal(amount_paise) / 100, currency="INR",
        status=PaymentStatus.PENDING, gateway="razorpay", gateway_order_id=order["id"],
        quote_id=quote.id if quote else None,
    )
    db.add(payment)
    await db.flush()

    await audit_service.log_action(
        db, user_id=case.junior_lawyer_id, action="payment.order_created",
        entity_type="payment", entity_id=str(payment.id),
        metadata={"type": payment_type.value, "amount_paise": amount_paise},
    )
    return payment


async def create_review_order(db: AsyncSession, *, case: Case) -> Payment:
    if case.status != CaseStatus.SUBMITTED:
        raise ConflictError(
            "The review fee can only be paid while the case is 'submitted' "
            f"(current: '{case.status.value}')"
        )
    reusable = await _reusable_payment(
        db, case_id=case.id, payment_type=PaymentType.REVIEW, quote_id=None
    )
    if reusable is not None:
        reusable.status = PaymentStatus.PENDING
        return reusable
    return await _create_order(
        db, case=case, payment_type=PaymentType.REVIEW,
        amount_paise=settings.review_fee_inr * 100,
    )


async def create_quote_order(db: AsyncSession, *, case: Case, quote: Quote) -> Payment:
    """The order amount comes from the quote row and nothing else: whatever the
    client sends is ignored."""
    if case.status != CaseStatus.QUOTED or quote.status != QuoteStatus.OPEN:
        raise ConflictError("There is no open price to pay for this case right now")
    reusable = await _reusable_payment(
        db, case_id=case.id, payment_type=PaymentType.QUOTE, quote_id=quote.id
    )
    if reusable is not None:
        reusable.status = PaymentStatus.PENDING
        return reusable
    return await _create_order(
        db, case=case, payment_type=PaymentType.QUOTE,
        amount_paise=quote.amount_paise, quote=quote,
    )


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    expected = hmac.new(
        settings.razorpay_webhook_secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _by_order(db: AsyncSession, gateway_order_id: str) -> Payment:
    result = await db.execute(select(Payment).where(Payment.gateway_order_id == gateway_order_id))
    payment = result.scalar_one_or_none()
    if payment is None:
        raise NotFoundError(f"No payment found for order {gateway_order_id}")
    return payment


async def handle_payment_failed(
    db: AsyncSession, *, gateway_order_id: str, error_description: str | None,
) -> Payment:
    payment = await _by_order(db, gateway_order_id)

    if payment.status in (PaymentStatus.PAID, PaymentStatus.FAILED, PaymentStatus.REFUNDED):
        # Already terminal — a captured payment can't retroactively fail, and
        # a redelivered failure event is an idempotent no-op.
        return payment

    payment.status = PaymentStatus.FAILED

    case = await case_service.get_case_or_404(db, payment.case_id)

    await audit_service.log_action(
        db, user_id=None, action="payment.failed",
        entity_type="payment", entity_id=str(payment.id),
        metadata={"error_description": error_description},
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id, case_id=case.id, kind="payment_failed",
        message=(
            f"Your payment of {format_inr(paise_from_rupees(payment.amount))} could not be "
            "completed. Please try again."
        ),
    )
    return payment


async def handle_payment_captured(
    db: AsyncSession, *, gateway_order_id: str, gateway_payment_id: str,
    amount_paise: int, currency: str = "INR",
) -> Payment:
    """A payment was captured. This is the only way money moves a case forward,
    and it moves exactly one edge: submitted -> review_fee_paid for the review
    fee, quoted -> delivered for a quote. Anything else that arrives (a
    redelivery, a payment for a replaced quote, a wrong amount) is recorded
    but does not unlock or change the case."""
    payment = await _by_order(db, gateway_order_id)

    # Take the case lock, then re-read: a quote being replaced or a second
    # delivery of this same event may have committed while we waited.
    case = await case_service.lock_case(db, payment.case_id)
    await db.refresh(payment)

    if payment.status in (PaymentStatus.PAID, PaymentStatus.REFUNDED):
        return payment  # webhook redelivery — idempotent no-op

    quote = None
    if payment.quote_id is not None:
        quote = (
            await db.execute(
                select(Quote).where(Quote.id == payment.quote_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()

    expected = quote.amount_paise if quote is not None else paise_from_rupees(payment.amount)
    if amount_paise != expected or currency != payment.currency:
        logger.warning(
            "payment_amount_mismatch", payment_id=str(payment.id),
            expected_paise=expected, got_paise=amount_paise, currency=currency,
        )
        await audit_service.log_action(
            db, user_id=None, action="payment.amount_mismatch",
            entity_type="payment", entity_id=str(payment.id),
            metadata={"expected_paise": expected, "got_paise": amount_paise, "currency": currency,
                      "gateway_payment_id": gateway_payment_id},
        )
        await notification_service.notify_reviewers(
            db, case_id=case.id, kind="payment_problem",
            message=f"A payment for '{case.title}' didn't match the expected amount. Check it in Payments.",
        )
        return payment

    payment.status = PaymentStatus.PAID
    payment.gateway_payment_id = gateway_payment_id
    payment.paid_at = datetime.now(timezone.utc)
    await audit_service.log_action(
        db, user_id=None, action="payment.captured",
        entity_type="payment", entity_id=str(payment.id),
        metadata={"gateway_payment_id": gateway_payment_id, "type": payment.type.value},
    )

    if payment.type == PaymentType.REVIEW:
        await _review_fee_paid(db, case=case, payment=payment)
    elif payment.type == PaymentType.QUOTE and quote is not None:
        await _quote_paid(db, case=case, payment=payment, quote=quote)
    else:
        # A retired fixed-fee payment type: money is recorded, nothing unlocks.
        await audit_service.log_action(
            db, user_id=None, action="payment.captured_no_effect",
            entity_type="payment", entity_id=str(payment.id),
            metadata={"reason": "retired_payment_type", "type": payment.type.value},
        )
    return payment


async def _review_fee_paid(db: AsyncSession, *, case: Case, payment: Payment) -> None:
    if case.status != CaseStatus.SUBMITTED:
        # e.g. a duplicate payment after the case already moved on. The money
        # is recorded (visible in Payments) but the case is left where it is.
        await audit_service.log_action(
            db, user_id=None, action="payment.captured_no_effect",
            entity_type="payment", entity_id=str(payment.id),
            metadata={"reason": "case_not_submitted", "case_status": case.status.value},
        )
        return

    case_service.transition(case, CaseStatus.REVIEW_FEE_PAID, by=None)
    price = format_inr(paise_from_rupees(payment.amount))
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id, case_id=case.id, kind="review_paid",
        message=f"Payment of {price} received. Your case is now with the advocate.",
    )
    await notification_service.notify_reviewers(
        db, case_id=case.id, kind="case_ready_for_review",
        message=f"New case to review: '{case.title}'.",
    )


# How a hand-recorded payment reads in the chat and notifications.
_RECEIVED_HOW = {
    OfflineMethod.CASH.value: " in cash",
    OfflineMethod.UPI.value: " by UPI",
    OfflineMethod.BANK_TRANSFER.value: " by bank transfer",
    OfflineMethod.CHEQUE.value: " by cheque",
}


async def _quote_paid(db: AsyncSession, *, case: Case, payment: Payment, quote: Quote) -> None:
    price = format_inr(quote.amount_paise)
    how = _RECEIVED_HOW.get(payment.method or "", "")
    if quote.status != QuoteStatus.OPEN or case.status != CaseStatus.QUOTED:
        # The advocate replaced the price while this payment was in flight (or
        # the case moved on). Do not unlock: give the money back.
        await _auto_refund(
            db, case=case, payment=payment,
            reason="quote_superseded" if quote.status == QuoteStatus.SUPERSEDED else "case_not_quoted",
        )
        return

    quote.status = QuoteStatus.PAID
    quote.paid_at = payment.paid_at
    case_service.transition(case, CaseStatus.DELIVERED, by=None)

    await audit_service.log_action(
        db, user_id=None, action="quote.paid", entity_type="quote", entity_id=str(quote.id),
        metadata={"case_id": str(case.id), "version": quote.version, "amount_paise": quote.amount_paise},
    )
    await message_service.post_event(
        db, case=case, kind=MessageKind.SYSTEM,
        body=f"Payment of {price} received{how}. The draft is unlocked.",
        meta={
            "event": "quote_paid", "quote_id": str(quote.id), "amount_paise": quote.amount_paise,
            "gateway": payment.gateway,
        },
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id, case_id=case.id, kind="quote_paid",
        message=f"Payment of {price} received{how}. Your draft for '{case.title}' is unlocked.",
    )
    await notification_service.notify_reviewers(
        db, case_id=case.id, kind="quote_paid",
        message=f"Payment of {price} received{how} for '{case.title}'. The draft is now with the lawyer.",
    )


async def _auto_refund(db: AsyncSession, *, case: Case, payment: Payment, reason: str) -> None:
    price = format_inr(paise_from_rupees(payment.amount))
    try:
        _razorpay_client().payment.refund(payment.gateway_payment_id, {})
    except Exception as exc:  # the gateway is external; never lose the webhook over it
        error = f"{type(exc).__name__}: {exc}"  # the gateway's exceptions can have an empty message
        logger.error("auto_refund_failed", payment_id=str(payment.id), error=error)
        await audit_service.log_action(
            db, user_id=None, action="payment.auto_refund_failed",
            entity_type="payment", entity_id=str(payment.id),
            metadata={"reason": reason, "error": error},
        )
        await notification_service.notify_reviewers(
            db, case_id=case.id, kind="payment_problem",
            message=(
                f"An automatic refund of {price} for '{case.title}' failed. "
                "Refund it from Payments."
            ),
        )
        return

    await audit_service.log_action(
        db, user_id=None, action="payment.auto_refund_initiated",
        entity_type="payment", entity_id=str(payment.id), metadata={"reason": reason},
    )
    await message_service.post_event(
        db, case=case, kind=MessageKind.SYSTEM,
        body=f"A payment of {price} for an earlier price was refunded automatically. Please pay the updated price.",
        meta={"event": "payment_auto_refunded", "reason": reason},
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id, case_id=case.id, kind="payment_refunded",
        message=(
            f"The price for '{case.title}' changed before your payment of {price} went through, "
            "so it is being refunded. Please pay the updated price."
        ),
    )


async def record_offline_payment(
    db: AsyncSession, *, case_id: uuid.UUID, admin: User, method: OfflineMethod,
    reference: str | None,
) -> Payment:
    """The advocate received the drafting charges outside Razorpay (cash, GPay,
    a bank transfer, a cheque) and says so. This is the one place a person
    moves a case along the edge a payment takes (quoted -> delivered), so it
    checks its own source status, takes the case lock like the webhook does,
    and then unlocks the draft through exactly the same `_quote_paid`.

    The amount is the open quote's, never the caller's. If the lawyer also
    pays through Razorpay later (a checkout left open), that capture finds
    the quote already paid and is refunded automatically."""
    case = await case_service.lock_case(db, case_id)
    quote = (
        await db.execute(
            select(Quote).where(Quote.case_id == case.id, Quote.status == QuoteStatus.OPEN)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if case.status != CaseStatus.QUOTED or quote is None:
        raise ConflictError("There are no unpaid drafting charges on this case")

    payment = Payment(
        case_id=case.id, type=PaymentType.QUOTE, quote_id=quote.id,
        amount=Decimal(quote.amount_paise) / 100, currency=quote.currency,
        status=PaymentStatus.PAID, gateway="offline", method=method.value,
        reference=reference, recorded_by=admin.id, paid_at=datetime.now(timezone.utc),
    )
    db.add(payment)
    await db.flush()
    await audit_service.log_action(
        db, user_id=admin.id, action="payment.recorded_offline",
        entity_type="payment", entity_id=str(payment.id),
        metadata={
            "case_id": str(case.id), "quote_id": str(quote.id), "method": method.value,
            "amount_paise": quote.amount_paise, "reference": reference,
        },
    )
    await _quote_paid(db, case=case, payment=payment, quote=quote)
    return payment


async def get_payment_or_404(db: AsyncSession, payment_id: uuid.UUID) -> Payment:
    result = await db.execute(select(Payment).where(Payment.id == payment_id))
    payment = result.scalar_one_or_none()
    if payment is None:
        raise NotFoundError("Payment not found")
    return payment


async def reconcile_payment(db: AsyncSession, *, payment: Payment) -> Payment:
    """Ask Razorpay what really happened, for when the webhook is late (F-12).
    Feeds a captured payment through the same handler the webhook uses, so both
    paths do exactly the same thing and doing both is harmless."""
    if payment.status not in (PaymentStatus.PENDING, PaymentStatus.FAILED):
        return payment

    result = _razorpay_client().order.payments(payment.gateway_order_id)
    captured = next(
        (item for item in result.get("items", []) if item.get("status") == "captured"), None
    )
    if captured is not None:
        await handle_payment_captured(
            db, gateway_order_id=payment.gateway_order_id, gateway_payment_id=captured["id"],
            amount_paise=captured["amount"], currency=captured.get("currency", "INR"),
        )
    return payment


async def refund_payment(db: AsyncSession, *, payment: Payment, admin: User) -> Payment:
    """Initiates a Razorpay refund for a captured payment. The refund is only
    confirmed (status -> REFUNDED) once the `refund.processed` webhook lands —
    this call just kicks it off. A refunded quote revokes the lawyer's access
    to the draft but does not roll the case back (docs/NEW_FLOW_SPEC.md §4)."""
    if payment.status != PaymentStatus.PAID:
        raise ConflictError(
            f"Only a 'paid' payment can be refunded (current status: '{payment.status.value}')"
        )

    if payment.gateway == "offline":
        # No gateway to wait for: the advocate gave the money back in person
        # (or recorded it by mistake), so the refund takes effect now.
        await case_service.lock_case(db, payment.case_id)
        await audit_service.log_action(
            db, user_id=admin.id, action="payment.refund_recorded_offline",
            entity_type="payment", entity_id=str(payment.id),
        )
        await _apply_refund(db, payment=payment)
        return payment

    _razorpay_client().payment.refund(payment.gateway_payment_id, {})

    await audit_service.log_action(
        db, user_id=admin.id, action="payment.refund_initiated",
        entity_type="payment", entity_id=str(payment.id),
    )
    return payment


async def handle_refund_processed(db: AsyncSession, *, gateway_payment_id: str) -> Payment:
    result = await db.execute(
        select(Payment).where(Payment.gateway_payment_id == gateway_payment_id)
    )
    payment = result.scalar_one_or_none()
    if payment is None:
        raise NotFoundError(f"No payment found for gateway payment {gateway_payment_id}")

    if payment.status == PaymentStatus.REFUNDED:
        return payment

    await _apply_refund(db, payment=payment)
    return payment


async def _apply_refund(db: AsyncSession, *, payment: Payment) -> None:
    """The money is back with the lawyer: mark it, and lock the draft again if
    this payment was what unlocked it."""
    payment.status = PaymentStatus.REFUNDED
    payment.refunded_at = datetime.now(timezone.utc)

    case = await case_service.get_case_or_404(db, payment.case_id)

    if payment.quote_id is not None:
        quote = (
            await db.execute(select(Quote).where(Quote.id == payment.quote_id))
        ).scalar_one()
        if quote.status == QuoteStatus.PAID:
            quote.status = QuoteStatus.REFUNDED  # access to the draft is revoked
            await message_service.post_event(
                db, case=case, kind=MessageKind.SYSTEM,
                body=(
                    f"Payment of {format_inr(paise_from_rupees(payment.amount))} was refunded. "
                    "The draft is locked again."
                ),
                meta={"event": "quote_refunded", "quote_id": str(quote.id)},
            )

    await audit_service.log_action(
        db, user_id=None, action="payment.refunded",
        entity_type="payment", entity_id=str(payment.id),
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id, case_id=case.id, kind="payment_refunded",
        message=f"Your payment of {format_inr(paise_from_rupees(payment.amount))} has been refunded.",
    )
