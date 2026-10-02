"""Drafting charges paid outside Razorpay (cash, GPay/UPI, bank transfer,
cheque): the advocate records them and the draft unlocks, exactly as a
Razorpay payment would."""
import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.case import CaseStatus
from app.models.message import Message
from app.models.notification import Notification
from app.models.payment import Payment, PaymentStatus, PaymentType
from app.models.quote import Quote, QuoteStatus
from app.services import payment_service
from tests.conftest import auth_header, make_case, make_user
from tests.helpers import seed_payment, seed_quote


async def _quoted(db_session, amount_paise=250_000):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.QUOTED)
    quote = await seed_quote(db_session, case, admin=admin, amount_paise=amount_paise)
    # Read now: after expire_all() a lazy load can't happen in async code.
    quote.ids = (quote.id, quote.draft_document_id)
    return lawyer, admin, case, quote


def _record(client, case, user, **body):
    return client.post(
        f"/cases/{case.id}/quote/record-payment", json={"method": "upi", **body},
        headers=auth_header(user),
    )


async def test_recording_a_upi_payment_unlocks_the_draft(client, db_session):
    lawyer, admin, case, quote = await _quoted(db_session)
    quote_id, draft_id = quote.ids
    case_id, lawyer_id, admin_id = case.id, lawyer.id, admin.id
    as_lawyer = auth_header(lawyer)

    resp = await _record(client, case, admin, reference="  UPI 4021 7788  ")
    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert (out["status"], out["gateway"], out["method"], out["reference"]) == ("paid", "offline", "upi", "UPI 4021 7788")
    assert out["amount"] == 2500 and out["quote_id"] == str(quote_id)

    db_session.expire_all()
    case = await db_session.get(type(case), case_id)
    quote = await db_session.get(Quote, quote_id)
    assert case.status == CaseStatus.DELIVERED and quote.status == QuoteStatus.PAID

    payment = (await db_session.execute(select(Payment))).scalar_one()
    assert payment.recorded_by == admin_id and payment.gateway_order_id is None

    # The chat line, the lawyer's notification and the audit entry, as for Razorpay.
    line = (await db_session.execute(select(Message).where(Message.case_id == case_id))).scalar_one()
    assert line.body == "Payment of ₹2,500 received by UPI. The draft is unlocked."
    note = (await db_session.execute(select(Notification).where(Notification.user_id == lawyer_id))).scalar_one()
    assert note.kind == "quote_paid" and "by UPI" in note.message
    actions = [a for (a,) in (await db_session.execute(select(AuditLog.action))).all()]
    assert "payment.recorded_offline" in actions and "quote.paid" in actions

    # And the lawyer can now download it.
    dl = await client.get(f"/documents/{draft_id}/download-url", headers=as_lawyer)
    assert dl.status_code == 200, dl.text


async def test_the_amount_is_always_the_quotes(client, db_session):
    lawyer, admin, case, quote = await _quoted(db_session, amount_paise=410_000)
    resp = await _record(client, case, admin, method="cash", amount=1, amount_inr=1, amount_paise=100)
    assert resp.status_code == 201 and resp.json()["amount"] == 4100


@pytest.mark.parametrize("method,how", [
    ("cash", " in cash"), ("bank_transfer", " by bank transfer"), ("cheque", " by cheque"), ("other", ""),
])
async def test_each_method_reads_plainly_in_the_chat(client, db_session, method, how):
    lawyer, admin, case, quote = await _quoted(db_session)
    assert (await _record(client, case, admin, method=method)).status_code == 201
    line = (await db_session.execute(select(Message).where(Message.case_id == case.id))).scalar_one()
    assert line.body == f"Payment of ₹2,500 received{how}. The draft is unlocked."


async def test_an_unknown_method_is_refused(client, db_session):
    lawyer, admin, case, quote = await _quoted(db_session)
    assert (await _record(client, case, admin, method="barter")).status_code == 422


async def test_recording_twice_is_refused_and_records_one_payment(client, db_session):
    lawyer, admin, case, quote = await _quoted(db_session)
    assert (await _record(client, case, admin)).status_code == 201
    second = await _record(client, case, admin, method="cash")
    assert second.status_code == 409
    assert len((await db_session.execute(select(Payment))).scalars().all()) == 1


async def test_the_lawyer_cannot_mark_their_own_charges_paid(client, db_session):
    lawyer, admin, case, quote = await _quoted(db_session)
    assert (await _record(client, case, lawyer)).status_code == 403
    await db_session.refresh(case)
    assert case.status == CaseStatus.QUOTED


async def test_a_razorpay_payment_landing_afterwards_is_refunded_not_double_counted(
    client, db_session, fake_razorpay,
):
    lawyer, admin, case, quote = await _quoted(db_session)
    await seed_payment(db_session, case, type=PaymentType.QUOTE, amount=2500, quote=quote, order_id="order_q")
    assert (await _record(client, case, admin, method="cash")).status_code == 201

    # The checkout the lawyer had left open goes through after all.
    await payment_service.handle_payment_captured(
        db_session, gateway_order_id="order_q", gateway_payment_id="pay_late", amount_paise=250_000,
    )
    await db_session.commit()
    assert fake_razorpay.refunds == ["pay_late"]


async def test_refunding_an_offline_payment_locks_the_draft_without_calling_razorpay(
    client, db_session, fake_razorpay,
):
    lawyer, admin, case, quote = await _quoted(db_session)
    quote_id, draft_id = quote.ids
    as_lawyer = auth_header(lawyer)
    payment_id = (await _record(client, case, admin)).json()["id"]

    resp = await client.post(f"/payments/{payment_id}/refund", headers=auth_header(admin))
    assert resp.status_code == 200 and resp.json()["status"] == "refunded"
    assert fake_razorpay.refunds == []

    db_session.expire_all()
    assert (await db_session.get(Quote, quote_id)).status == QuoteStatus.REFUNDED
    dl = await client.get(f"/documents/{draft_id}/download-url", headers=as_lawyer)
    assert dl.status_code == 403


async def test_the_payments_list_shows_how_it_was_paid(client, db_session):
    lawyer, admin, case, quote = await _quoted(db_session)
    await _record(client, case, admin, method="cheque", reference="CHQ 000123")
    rows = (await client.get("/payments", headers=auth_header(admin))).json()
    assert [(r["gateway"], r["method"], r["reference"]) for r in rows] == [("offline", "cheque", "CHQ 000123")]
    assert rows[0]["status"] == PaymentStatus.PAID.value
