import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.models.case import CaseStatus
from app.models.document import CaseDocument, DocumentType
from app.models.notification import Notification
from app.models.quote import Quote, QuoteStatus
from tests.conftest import auth_header, make_case, make_user
from tests.helpers import seed_quote


async def _accepted_case(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.ACCEPTED)
    return lawyer, admin, case


def _body(key, amount=2500, filename="bail-application.pdf", note=None):
    body = {"draft": {"storage_key": key, "original_filename": filename}, "amount_inr": amount}
    if note is not None:
        body["note"] = note
    return body


async def _quote_rows(db_session, case):
    case_id = case.id  # read before expiring: a lazy load can't happen in async code
    db_session.expire_all()
    return (await db_session.execute(
        select(Quote).where(Quote.case_id == case_id).order_by(Quote.version)
    )).scalars().all()


async def test_advocate_sends_draft_and_price_together(client, db_session, fake_store):
    lawyer, admin, case = await _accepted_case(db_session)
    key = fake_store.put_pdf(case, pages=8)

    resp = await client.post(
        f"/cases/{case.id}/quote", json=_body(key, 2500, note="  Includes annexures  "),
        headers=auth_header(admin),
    )
    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert (out["version"], out["amount_inr"], out["amount_paise"], out["status"]) == (1, 2500, 250000, "open")
    assert out["note"] == "Includes annexures"

    await db_session.refresh(case)
    assert case.status == CaseStatus.QUOTED

    draft = (await db_session.execute(select(CaseDocument).where(CaseDocument.type == DocumentType.DRAFT))).scalar_one()
    assert (draft.version, draft.page_count, draft.content_type) == (1, 8, "application/pdf")
    assert draft.size_bytes == len(fake_store.objects[key])
    assert out["draft_document_id"] == str(draft.id)  # counted by the server, not claimed by the client

    note = (await db_session.execute(select(Notification).where(Notification.user_id == lawyer.id))).scalar_one()
    assert "₹2,500" in note.message and note.kind == "quote_sent" and note.case_id == case.id


@pytest.mark.parametrize("amount", [0, 99, 100_001, -5])
async def test_a_price_outside_the_bounds_is_refused_and_changes_nothing(client, db_session, fake_store, amount):
    lawyer, admin, case = await _accepted_case(db_session)
    key = fake_store.put_pdf(case)

    resp = await client.post(f"/cases/{case.id}/quote", json=_body(key, amount), headers=auth_header(admin))
    assert resp.status_code == 422
    assert "₹100" in resp.json()["detail"] and "₹1,00,000" in resp.json()["detail"]

    await db_session.refresh(case)
    assert case.status == CaseStatus.ACCEPTED
    assert await _quote_rows(db_session, case) == []
    assert key in fake_store.objects  # nothing was filed or deleted


async def test_the_bounds_come_from_config(client, db_session, fake_store, monkeypatch):
    lawyer, admin, case = await _accepted_case(db_session)
    monkeypatch.setattr(settings, "quote_min_inr", 500)
    resp = await client.post(
        f"/cases/{case.id}/quote", json=_body(fake_store.put_pdf(case), 400), headers=auth_header(admin),
    )
    assert resp.status_code == 422 and "₹500" in resp.json()["detail"]


async def test_there_is_no_quote_without_a_draft(client, db_session, fake_store):
    lawyer, admin, case = await _accepted_case(db_session)
    missing = f"cases/{case.id}/never-uploaded.pdf"

    resp = await client.post(f"/cases/{case.id}/quote", json=_body(missing), headers=auth_header(admin))
    assert resp.status_code == 422 and "couldn't find" in resp.json()["detail"]
    await db_session.refresh(case)
    assert case.status == CaseStatus.ACCEPTED


async def test_a_file_that_is_not_a_pdf_is_refused_and_removed(client, db_session, fake_store):
    lawyer, admin, case = await _accepted_case(db_session)
    key = fake_store.put(f"cases/{case.id}/x_draft.pdf", b"MZ\x90\x00 this is an executable, named .pdf")

    resp = await client.post(f"/cases/{case.id}/quote", json=_body(key), headers=auth_header(admin))
    assert resp.status_code == 422 and "isn't a PDF" in resp.json()["detail"]
    assert key in fake_store.deleted
    assert await _quote_rows(db_session, case) == []


async def test_a_corrupt_pdf_is_refused(client, db_session, fake_store):
    lawyer, admin, case = await _accepted_case(db_session)
    key = fake_store.put(f"cases/{case.id}/x_draft.pdf", b"%PDF-1.7\nthis is not a real pdf body")

    resp = await client.post(f"/cases/{case.id}/quote", json=_body(key), headers=auth_header(admin))
    assert resp.status_code == 422 and "couldn't read" in resp.json()["detail"].lower()
    assert key in fake_store.deleted


async def test_an_oversized_draft_is_refused_and_removed(client, db_session, fake_store, monkeypatch):
    lawyer, admin, case = await _accepted_case(db_session)
    key = fake_store.put_pdf(case)
    monkeypatch.setattr(settings, "max_file_size_mb", 0)

    resp = await client.post(f"/cases/{case.id}/quote", json=_body(key), headers=auth_header(admin))
    assert resp.status_code == 422 and "at most" in resp.json()["detail"]
    assert key in fake_store.deleted


async def test_the_draft_must_be_named_as_a_pdf(client, db_session, fake_store):
    lawyer, admin, case = await _accepted_case(db_session)
    key = fake_store.put_pdf(case)
    resp = await client.post(
        f"/cases/{case.id}/quote", json=_body(key, filename="draft.docx"), headers=auth_header(admin),
    )
    assert resp.status_code == 422


async def test_a_key_from_another_case_is_refused_and_left_alone(client, db_session, fake_store):
    lawyer, admin, case = await _accepted_case(db_session)
    other = await make_case(db_session, lawyer, status=CaseStatus.ACCEPTED, title="Another case")
    theirs = fake_store.put_pdf(other)

    resp = await client.post(f"/cases/{case.id}/quote", json=_body(theirs), headers=auth_header(admin))
    assert resp.status_code == 422
    assert theirs in fake_store.objects and theirs not in fake_store.deleted


async def test_an_already_registered_file_cannot_be_reused_or_destroyed(client, db_session, fake_store):
    """Pointing the draft at the junior's own original must not delete it, even
    if it would fail the checks."""
    lawyer, admin, case = await _accepted_case(db_session)
    key = fake_store.put(f"cases/{case.id}/orig.pdf", b"not a pdf at all")
    db_session.add(CaseDocument(
        case_id=case.id, type=DocumentType.ORIGINAL, version=1, storage_key=key,
        original_filename="orig.pdf", uploaded_by=lawyer.id,
    ))
    await db_session.commit()

    resp = await client.post(f"/cases/{case.id}/quote", json=_body(key), headers=auth_header(admin))
    assert resp.status_code == 422 and "already been added" in resp.json()["detail"]
    assert key in fake_store.objects and key not in fake_store.deleted


@pytest.mark.parametrize("role", ["junior_lawyer", "clerk", "accountant"])
async def test_only_the_advocate_can_send_a_quote(client, db_session, fake_store, role):
    lawyer, admin, case = await _accepted_case(db_session)
    actor = lawyer if role == "junior_lawyer" else await make_user(db_session, role_name=role)
    resp = await client.post(
        f"/cases/{case.id}/quote", json=_body(fake_store.put_pdf(case)), headers=auth_header(actor),
    )
    assert resp.status_code == 403


@pytest.mark.parametrize("status", [CaseStatus.SUBMITTED, CaseStatus.REVIEW_FEE_PAID, CaseStatus.DELIVERED, CaseStatus.COMPLETED])
async def test_a_quote_only_from_accepted_or_quoted(client, db_session, fake_store, status):
    lawyer, admin, case = await _accepted_case(db_session)
    case.status = status
    await db_session.commit()
    resp = await client.post(
        f"/cases/{case.id}/quote", json=_body(fake_store.put_pdf(case)), headers=auth_header(admin),
    )
    assert resp.status_code == 409


async def test_replacing_an_unpaid_quote_supersedes_it(client, db_session, fake_store):
    lawyer, admin, case = await _accepted_case(db_session)
    lawyer_id = lawyer.id  # ids are read up front; expire_all() below would make them lazy
    first = await client.post(
        f"/cases/{case.id}/quote", json=_body(fake_store.put_pdf(case, pages=2), 2500), headers=auth_header(admin),
    )
    assert first.status_code == 201

    second = await client.post(
        f"/cases/{case.id}/quote", json=_body(fake_store.put_pdf(case, pages=5), 3000), headers=auth_header(admin),
    )
    assert second.status_code == 201 and second.json()["version"] == 2

    quotes = await _quote_rows(db_session, case)
    assert [(q.version, q.status, q.amount_paise) for q in quotes] == [
        (1, QuoteStatus.SUPERSEDED, 250000), (2, QuoteStatus.OPEN, 300000),
    ]
    await db_session.refresh(case)
    assert case.status == CaseStatus.QUOTED

    versions = (await db_session.execute(
        select(CaseDocument.version, CaseDocument.page_count)
        .where(CaseDocument.type == DocumentType.DRAFT).order_by(CaseDocument.version)
    )).all()
    assert versions == [(1, 2), (2, 5)]  # the first draft is kept, not overwritten

    notes = (await db_session.execute(
        select(Notification.message).where(Notification.user_id == lawyer_id).order_by(Notification.created_at)
    )).scalars().all()
    assert "updated to ₹3,000" in notes[-1]


async def test_the_database_allows_only_one_open_quote_per_case(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.QUOTED)
    await seed_quote(db_session, case, admin=admin, version=1)
    with pytest.raises(IntegrityError):
        await seed_quote(db_session, case, admin=admin, version=2)


async def test_the_owner_and_advocate_can_read_the_quote_but_not_another_lawyer(client, db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    other = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.QUOTED)
    await seed_quote(db_session, case, admin=admin, amount_paise=180000)

    for user in (lawyer, admin):
        resp = await client.get(f"/cases/{case.id}/quote", headers=auth_header(user))
        assert resp.status_code == 200 and resp.json()["amount_inr"] == 1800
    assert (await client.get(f"/cases/{case.id}/quote", headers=auth_header(other))).status_code == 403


async def test_reading_a_quote_that_does_not_exist_is_a_404(client, db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await make_case(db_session, lawyer, status=CaseStatus.ACCEPTED)
    assert (await client.get(f"/cases/{case.id}/quote", headers=auth_header(lawyer))).status_code == 404


# --- paying a quote -----------------------------------------------------

async def _quoted(db_session, amount_paise=250000):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.QUOTED)
    quote = await seed_quote(db_session, case, admin=admin, amount_paise=amount_paise)
    return lawyer, admin, case, quote


async def test_the_order_amount_is_the_quotes_and_a_client_amount_is_ignored(client, db_session, fake_razorpay):
    lawyer, admin, case, quote = await _quoted(db_session, amount_paise=250000)

    resp = await client.post(
        f"/cases/{case.id}/quote/pay", json={"amount_inr": 1, "amount": 100, "amount_paise": 100},
        headers=auth_header(lawyer),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["amount_paise"] == 250000
    assert [o["amount"] for o in fake_razorpay.orders] == [250000]
    assert fake_razorpay.orders[0]["notes"]["quote_id"] == str(quote.id)


async def test_paying_twice_reuses_the_same_order(client, db_session, fake_razorpay):
    lawyer, admin, case, quote = await _quoted(db_session)
    first = (await client.post(f"/cases/{case.id}/quote/pay", headers=auth_header(lawyer))).json()
    second = (await client.post(f"/cases/{case.id}/quote/pay", headers=auth_header(lawyer))).json()

    assert first["razorpay_order_id"] == second["razorpay_order_id"]
    assert first["payment_id"] == second["payment_id"]
    assert len(fake_razorpay.orders) == 1


async def test_a_replaced_quote_gets_its_own_order_at_the_new_price(client, db_session, fake_store, fake_razorpay):
    lawyer, admin, case, quote = await _quoted(db_session, amount_paise=250000)
    old = (await client.post(f"/cases/{case.id}/quote/pay", headers=auth_header(lawyer))).json()

    await client.post(
        f"/cases/{case.id}/quote", json=_body(fake_store.put_pdf(case), 3000), headers=auth_header(admin),
    )
    new = (await client.post(f"/cases/{case.id}/quote/pay", headers=auth_header(lawyer))).json()

    assert new["razorpay_order_id"] != old["razorpay_order_id"]
    assert new["amount_paise"] == 300000


@pytest.mark.parametrize("status", [CaseStatus.ACCEPTED, CaseStatus.DELIVERED, CaseStatus.COMPLETED])
async def test_nothing_to_pay_outside_quoted(client, db_session, fake_razorpay, status):
    lawyer, admin, case, quote = await _quoted(db_session)
    case.status = status
    await db_session.commit()
    resp = await client.post(f"/cases/{case.id}/quote/pay", headers=auth_header(lawyer))
    assert resp.status_code == 409 and fake_razorpay.orders == []


async def test_a_superseded_quote_cannot_be_paid(client, db_session, fake_razorpay):
    lawyer, admin, case, quote = await _quoted(db_session)
    quote.status = QuoteStatus.SUPERSEDED
    await db_session.commit()
    await seed_quote(db_session, case, admin=admin, version=2, amount_paise=300000)

    resp = await client.post(f"/cases/{case.id}/quote/pay", headers=auth_header(lawyer))
    assert resp.status_code == 200 and resp.json()["amount_paise"] == 300000  # the current quote, never the old one
