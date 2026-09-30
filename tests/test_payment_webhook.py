import hashlib
import hmac

import pytest
from sqlalchemy import select

from app.config import settings

from app.core.exceptions import NotFoundError
from app.models.audit_log import AuditLog
from app.models.case import CaseStatus
from app.models.notification import Notification
from app.models.payment import Payment, PaymentStatus, PaymentType
from app.models.quote import QuoteStatus
from app.services import payment_service
from tests.conftest import auth_header, make_case, make_user
from tests.helpers import seed_payment, seed_quote, signed_webhook


def _sign(body: bytes) -> str:
    return hmac.new(settings.razorpay_webhook_secret.encode(), body, hashlib.sha256).hexdigest()


def test_verify_webhook_signature_accepts_correct_signature():
    body = b'{"event": "payment.captured"}'
    assert payment_service.verify_webhook_signature(body, _sign(body)) is True


def test_verify_webhook_signature_rejects_tampered_body():
    body = b'{"event": "payment.captured"}'
    tampered = b'{"event": "payment.captured", "extra": "x"}'
    assert payment_service.verify_webhook_signature(tampered, _sign(body)) is False


async def _capture(db_session, *, order_id="order_abc", payment_id="pay_abc", paise=10000, currency="INR"):
    payment = await payment_service.handle_payment_captured(
        db_session, gateway_order_id=order_id, gateway_payment_id=payment_id,
        amount_paise=paise, currency=currency,
    )
    await db_session.commit()
    return payment


async def _audit_actions(db_session):
    return [a for (a,) in (await db_session.execute(select(AuditLog.action))).all()]


# --- the review fee -------------------------------------------------------

async def _submitted(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.SUBMITTED)
    payment = await seed_payment(db_session, case, amount=100)
    return lawyer, admin, case, payment


async def test_review_fee_capture_moves_the_case_and_tells_both_sides(db_session):
    lawyer, admin, case, payment = await _submitted(db_session)
    ids = (lawyer.id, admin.id)

    paid = await _capture(db_session)
    assert paid.status == PaymentStatus.PAID and paid.paid_at is not None
    await db_session.refresh(case)
    assert case.status == CaseStatus.REVIEW_FEE_PAID

    notes = {n.user_id: n for n in (await db_session.execute(select(Notification))).scalars().all()}
    assert "₹100" in notes[ids[0]].message and notes[ids[0]].kind == "review_paid"
    assert "New case to review" in notes[ids[1]].message and notes[ids[1]].kind == "case_ready_for_review"  # F-03


async def test_a_redelivered_capture_changes_nothing(db_session):
    lawyer, admin, case, payment = await _submitted(db_session)
    first = await _capture(db_session)
    paid_at, actions_before = first.paid_at, len(await _audit_actions(db_session))
    notes_before = len((await db_session.execute(select(Notification))).scalars().all())

    second = await _capture(db_session)
    assert second.status == PaymentStatus.PAID and second.paid_at == paid_at
    assert len(await _audit_actions(db_session)) == actions_before
    assert len((await db_session.execute(select(Notification))).scalars().all()) == notes_before


async def test_a_capture_cannot_drag_a_later_case_back_to_review(db_session):
    """The old handler set the status unconditionally, so a late or duplicate
    payment could move an accepted case back to 'review_fee_paid'."""
    lawyer, admin, case, payment = await _submitted(db_session)
    case.status = CaseStatus.ACCEPTED
    await db_session.commit()

    paid = await _capture(db_session)
    assert paid.status == PaymentStatus.PAID  # the money is recorded
    await db_session.refresh(case)
    assert case.status == CaseStatus.ACCEPTED
    assert "payment.captured_no_effect" in await _audit_actions(db_session)


@pytest.mark.parametrize("paise,currency", [(1, "INR"), (99999, "INR"), (10000, "USD")])
async def test_a_wrong_amount_or_currency_unlocks_nothing(db_session, paise, currency):
    lawyer, admin, case, payment = await _submitted(db_session)

    result = await _capture(db_session, paise=paise, currency=currency)
    assert result.status == PaymentStatus.PENDING
    await db_session.refresh(case)
    assert case.status == CaseStatus.SUBMITTED
    assert "payment.amount_mismatch" in await _audit_actions(db_session)
    admin_notes = (await db_session.execute(
        select(Notification).where(Notification.kind == "payment_problem")
    )).scalars().all()
    assert len(admin_notes) == 1  # the advocate hears about it


async def test_unknown_order_raises_not_found(db_session):
    with pytest.raises(NotFoundError):
        await payment_service.handle_payment_captured(
            db_session, gateway_order_id="does-not-exist", gateway_payment_id="pay_xyz", amount_paise=100,
        )


async def test_failed_payment_marks_status_and_leaves_case_untouched(db_session):
    lawyer, admin, case, payment = await _submitted(db_session)
    updated = await payment_service.handle_payment_failed(
        db_session, gateway_order_id="order_abc", error_description="Card declined",
    )
    assert updated.status == PaymentStatus.FAILED
    await db_session.refresh(case)
    assert case.status == CaseStatus.SUBMITTED


async def test_failed_is_a_noop_once_already_captured(db_session):
    await _submitted(db_session)
    await _capture(db_session)
    updated = await payment_service.handle_payment_failed(
        db_session, gateway_order_id="order_abc", error_description="too late",
    )
    assert updated.status == PaymentStatus.PAID


async def test_a_capture_after_a_failed_attempt_still_counts(db_session):
    """Razorpay lets an order be retried after a failed attempt."""
    lawyer, admin, case, payment = await _submitted(db_session)
    await payment_service.handle_payment_failed(db_session, gateway_order_id="order_abc", error_description="x")
    await db_session.commit()

    paid = await _capture(db_session)
    assert paid.status == PaymentStatus.PAID
    await db_session.refresh(case)
    assert case.status == CaseStatus.REVIEW_FEE_PAID


async def test_refund_processed_marks_refunded_and_sets_timestamp(db_session):
    lawyer, admin, case, payment = await _submitted(db_session)
    payment.status, payment.gateway_payment_id = PaymentStatus.PAID, "pay_abc"
    await db_session.commit()

    updated = await payment_service.handle_refund_processed(db_session, gateway_payment_id="pay_abc")
    assert updated.status == PaymentStatus.REFUNDED and updated.refunded_at is not None


# --- paying a quote -------------------------------------------------------

async def _quoted(db_session, amount_paise=250000):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.QUOTED)
    quote = await seed_quote(db_session, case, admin=admin, amount_paise=amount_paise)
    payment = await seed_payment(
        db_session, case, type=PaymentType.QUOTE, amount=amount_paise / 100, quote=quote, order_id="order_q1",
    )
    return lawyer, admin, case, quote, payment


async def test_paying_the_quote_unlocks_the_draft(db_session):
    lawyer, admin, case, quote, payment = await _quoted(db_session)

    await _capture(db_session, order_id="order_q1", payment_id="pay_q1", paise=250000)
    await db_session.refresh(case)
    await db_session.refresh(quote)
    assert case.status == CaseStatus.DELIVERED
    assert quote.status == QuoteStatus.PAID and quote.paid_at is not None

    kinds = sorted(n.kind for n in (await db_session.execute(select(Notification))).scalars().all())
    assert kinds == ["quote_paid", "quote_paid"]  # the lawyer and the advocate


async def test_a_quote_payment_for_the_wrong_amount_is_not_honoured(db_session):
    lawyer, admin, case, quote, payment = await _quoted(db_session, amount_paise=250000)
    await _capture(db_session, order_id="order_q1", payment_id="pay_q1", paise=25000)  # ₹250, not ₹2,500

    await db_session.refresh(case)
    await db_session.refresh(quote)
    assert case.status == CaseStatus.QUOTED and quote.status == QuoteStatus.OPEN


async def test_a_redelivered_quote_capture_is_a_noop(db_session):
    lawyer, admin, case, quote, payment = await _quoted(db_session)
    await _capture(db_session, order_id="order_q1", payment_id="pay_q1", paise=250000)
    before = len(await _audit_actions(db_session))
    await _capture(db_session, order_id="order_q1", payment_id="pay_q1", paise=250000)
    assert len(await _audit_actions(db_session)) == before


async def test_paying_a_replaced_quote_refunds_instead_of_unlocking(db_session, fake_razorpay):
    lawyer, admin, case, quote, payment = await _quoted(db_session)
    # The advocate replaced the price while the junior was in checkout.
    quote.status = QuoteStatus.SUPERSEDED
    await db_session.commit()
    new = await seed_quote(db_session, case, admin=admin, version=2, amount_paise=300000)
    new_id = new.id

    paid = await _capture(db_session, order_id="order_q1", payment_id="pay_q1", paise=250000)
    assert paid.status == PaymentStatus.PAID  # captured, so it must be refundable
    assert fake_razorpay.refunds == ["pay_q1"]

    await db_session.refresh(case)
    assert case.status == CaseStatus.QUOTED  # not unlocked
    current = (await db_session.execute(select(type(new)).where(type(new).id == new_id))).scalar_one()
    assert current.status == QuoteStatus.OPEN  # the new quote is untouched
    assert "payment.auto_refund_initiated" in await _audit_actions(db_session)
    refund_note = (await db_session.execute(
        select(Notification).where(Notification.kind == "payment_refunded")
    )).scalar_one()
    assert refund_note.user_id == lawyer.id


async def test_if_the_automatic_refund_fails_the_advocate_is_told_and_nothing_is_lost(db_session, fake_razorpay):
    lawyer, admin, case, quote, payment = await _quoted(db_session)
    quote.status = QuoteStatus.SUPERSEDED
    await db_session.commit()
    fake_razorpay.refund_error = RuntimeError("gateway timeout")

    paid = await _capture(db_session, order_id="order_q1", payment_id="pay_q1", paise=250000)
    assert paid.status == PaymentStatus.PAID
    assert "payment.auto_refund_failed" in await _audit_actions(db_session)
    problem = (await db_session.execute(
        select(Notification).where(Notification.kind == "payment_problem")
    )).scalar_one()
    assert "Refund it from Payments" in problem.message


async def test_a_refunded_quote_takes_the_draft_back_but_not_the_case(db_session):
    lawyer, admin, case, quote, payment = await _quoted(db_session)
    await _capture(db_session, order_id="order_q1", payment_id="pay_q1", paise=250000)

    await payment_service.handle_refund_processed(db_session, gateway_payment_id="pay_q1")
    await db_session.commit()
    await db_session.refresh(case)
    await db_session.refresh(quote)
    assert quote.status == QuoteStatus.REFUNDED
    assert case.status == CaseStatus.DELIVERED  # the case is not rolled back (spec Q3 default)


# --- the webhook endpoint ---------------------------------------------------

async def test_endpoint_rejects_a_bad_signature(client, db_session):
    body, headers = signed_webhook("payment.captured", {"id": "pay_1", "order_id": "order_abc", "amount": 100})
    headers["X-Razorpay-Signature"] = "0" * 64
    assert (await client.post("/webhooks/razorpay", content=body, headers=headers)).status_code == 401


async def test_endpoint_captures_a_signed_event_end_to_end(client, db_session):
    lawyer, admin, case, payment = await _submitted(db_session)
    body, headers = signed_webhook(
        "payment.captured", {"id": "pay_abc", "order_id": "order_abc", "amount": 10000, "currency": "INR"},
    )
    resp = await client.post("/webhooks/razorpay", content=body, headers=headers)
    assert resp.status_code == 200
    await db_session.refresh(case)
    assert case.status == CaseStatus.REVIEW_FEE_PAID


async def test_endpoint_replays_are_harmless(client, db_session):
    lawyer, admin, case, quote, payment = await _quoted(db_session)
    body, headers = signed_webhook(
        "payment.captured", {"id": "pay_q1", "order_id": "order_q1", "amount": 250000, "currency": "INR"},
    )
    for _ in range(3):
        assert (await client.post("/webhooks/razorpay", content=body, headers=headers)).status_code == 200

    db_session.expire_all()
    rows = (await db_session.execute(select(Payment))).scalars().all()
    assert [p.status for p in rows] == [PaymentStatus.PAID]
    notes = (await db_session.execute(select(Notification).where(Notification.kind == "quote_paid"))).scalars().all()
    assert len(notes) == 2  # one each for the lawyer and the advocate, not three of each


# --- "Check status" ---------------------------------------------------------

async def test_reconcile_picks_up_a_capture_the_webhook_missed(client, db_session, fake_razorpay):
    lawyer, admin, case, quote, payment = await _quoted(db_session)
    fake_razorpay.order_payments["order_q1"] = [
        {"id": "pay_q1", "status": "captured", "amount": 250000, "currency": "INR"},
    ]

    resp = await client.post(f"/payments/{payment.id}/reconcile", headers=auth_header(lawyer))
    assert resp.status_code == 200 and resp.json()["status"] == "paid"
    await db_session.refresh(case)
    assert case.status == CaseStatus.DELIVERED

    # ... and the webhook arriving afterwards changes nothing.
    body, headers = signed_webhook(
        "payment.captured", {"id": "pay_q1", "order_id": "order_q1", "amount": 250000, "currency": "INR"},
    )
    assert (await client.post("/webhooks/razorpay", content=body, headers=headers)).status_code == 200


async def test_reconcile_leaves_an_unpaid_payment_alone(client, db_session, fake_razorpay):
    lawyer, admin, case, quote, payment = await _quoted(db_session)
    fake_razorpay.order_payments["order_q1"] = [{"id": "pay_x", "status": "failed", "amount": 250000}]

    resp = await client.post(f"/payments/{payment.id}/reconcile", headers=auth_header(lawyer))
    assert resp.status_code == 200 and resp.json()["status"] == "pending"
    await db_session.refresh(case)
    assert case.status == CaseStatus.QUOTED


async def test_reconcile_does_not_call_razorpay_for_a_settled_payment(client, db_session, fake_razorpay, monkeypatch):
    lawyer, admin, case, quote, payment = await _quoted(db_session)
    await _capture(db_session, order_id="order_q1", payment_id="pay_q1", paise=250000)

    def boom(*_):
        raise AssertionError("should not ask the gateway")
    monkeypatch.setattr(fake_razorpay.order, "payments", boom)

    resp = await client.post(f"/payments/{payment.id}/reconcile", headers=auth_header(lawyer))
    assert resp.status_code == 200 and resp.json()["status"] == "paid"


async def test_reconcile_is_limited_to_people_with_access_to_the_case(client, db_session, fake_razorpay):
    lawyer, admin, case, quote, payment = await _quoted(db_session)
    stranger = await make_user(db_session, role_name="junior_lawyer")
    assert (await client.post(f"/payments/{payment.id}/reconcile", headers=auth_header(stranger))).status_code == 403


async def test_an_event_we_do_not_act_on_is_acknowledged_not_a_500(client):
    """Razorpay also sends order.paid, payment.authorized and others. A 500
    makes it retry and eventually disable the webhook."""
    import json
    body = json.dumps({"event": "order.paid", "payload": {}}).encode()
    resp = await client.post(
        "/webhooks/razorpay", content=body,
        headers={"X-Razorpay-Signature": _sign(body), "Content-Type": "application/json"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "ok"}
