import hashlib
import hmac

import pytest

from app.config import settings
from app.core.exceptions import NotFoundError
from app.models.case import CaseStatus
from app.models.payment import Payment, PaymentStatus, PaymentType
from app.schemas.case import CaseCreate
from app.services import case_service, payment_service
from tests.conftest import make_user


def _sign(body: bytes) -> str:
    return hmac.new(settings.razorpay_webhook_secret.encode(), body, hashlib.sha256).hexdigest()


def test_verify_webhook_signature_accepts_correct_signature():
    body = b'{"event": "payment.captured"}'
    assert payment_service.verify_webhook_signature(body, _sign(body)) is True


def test_verify_webhook_signature_rejects_tampered_body():
    body = b'{"event": "payment.captured"}'
    tampered = b'{"event": "payment.captured", "extra": "x"}'
    assert payment_service.verify_webhook_signature(tampered, _sign(body)) is False


async def _paid_case_and_payment(db_session, *, status=PaymentStatus.PENDING):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await case_service.create_case(
        db_session, junior_lawyer=lawyer, data=CaseCreate(title="Case", case_type="civil"),
    )
    payment = Payment(
        case_id=case.id, type=PaymentType.REVIEW, amount=100, currency="INR",
        status=status, gateway="razorpay", gateway_order_id="order_abc",
        gateway_payment_id="pay_abc" if status != PaymentStatus.PENDING else None,
    )
    db_session.add(payment)
    await db_session.flush()
    await db_session.commit()
    return case, payment


async def test_payment_captured_advances_case_and_payment_status(db_session):
    case, payment = await _paid_case_and_payment(db_session)

    updated = await payment_service.handle_payment_captured(
        db_session, gateway_order_id="order_abc", gateway_payment_id="pay_abc",
    )
    assert updated.status == PaymentStatus.PAID

    # Mirrors what the webhook router does: the service flushes but the
    # caller commits.
    await db_session.commit()
    await db_session.refresh(case)
    assert case.status == CaseStatus.REVIEW_FEE_PAID


async def test_payment_captured_is_idempotent_on_redelivery(db_session):
    case, payment = await _paid_case_and_payment(db_session)

    first = await payment_service.handle_payment_captured(
        db_session, gateway_order_id="order_abc", gateway_payment_id="pay_abc",
    )
    paid_at_first = first.paid_at

    second = await payment_service.handle_payment_captured(
        db_session, gateway_order_id="order_abc", gateway_payment_id="pay_abc",
    )
    assert second.status == PaymentStatus.PAID
    assert second.paid_at == paid_at_first


async def test_payment_captured_unknown_order_raises_not_found(db_session):
    with pytest.raises(NotFoundError):
        await payment_service.handle_payment_captured(
            db_session, gateway_order_id="does-not-exist", gateway_payment_id="pay_xyz",
        )


async def test_payment_failed_marks_status_and_leaves_case_untouched(db_session):
    case, payment = await _paid_case_and_payment(db_session)
    original_status = case.status

    updated = await payment_service.handle_payment_failed(
        db_session, gateway_order_id="order_abc", error_description="Card declined",
    )
    assert updated.status == PaymentStatus.FAILED

    await db_session.refresh(case)
    assert case.status == original_status


async def test_payment_failed_is_a_noop_once_already_captured(db_session):
    case, payment = await _paid_case_and_payment(db_session)
    await payment_service.handle_payment_captured(
        db_session, gateway_order_id="order_abc", gateway_payment_id="pay_abc",
    )

    updated = await payment_service.handle_payment_failed(
        db_session, gateway_order_id="order_abc", error_description="too late",
    )
    assert updated.status == PaymentStatus.PAID


async def test_refund_processed_marks_refunded_and_sets_timestamp(db_session):
    case, payment = await _paid_case_and_payment(db_session, status=PaymentStatus.PAID)

    updated = await payment_service.handle_refund_processed(
        db_session, gateway_payment_id="pay_abc",
    )
    assert updated.status == PaymentStatus.REFUNDED
    assert updated.refunded_at is not None
