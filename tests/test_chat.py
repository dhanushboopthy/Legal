"""A case's chat (docs/NEW_FLOW_SPEC.md §7): who may use it and when, sending
that never duplicates, paging, read state, the lines the server writes itself,
and notifications."""
import asyncio
import uuid

import pytest
from sqlalchemy import select

from app.models.case import CaseStatus
from app.models.document import CaseDocument, DocumentType
from app.models.message import Message, MessageKind
from app.models.notification import Notification
from tests.conftest import AsyncSessionLocal, auth_header, make_case, make_pdf, make_user
from tests.helpers import seed_draft, seed_original, seed_payment, signed_webhook

OPEN = [CaseStatus.ACCEPTED, CaseStatus.QUOTED, CaseStatus.DELIVERED, CaseStatus.REVISION_REQUESTED]
NO_CHAT = [CaseStatus.SUBMITTED, CaseStatus.REVIEW_FEE_PAID, CaseStatus.REJECTED]
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


async def chat(db, status=CaseStatus.ACCEPTED):
    lawyer = await make_user(db, role_name="junior_lawyer")
    advocate = await make_user(db, role_name="super_admin")
    return lawyer, advocate, await make_case(db, lawyer, status=status)


def send(client, user, case, body="Hello", **extra):
    payload = {"client_id": str(uuid.uuid4()), "body": body, **extra}
    return client.post(f"/cases/{case.id}/messages", headers=auth_header(user), json=payload)


def page(client, user, case, **params):
    return client.get(f"/cases/{case.id}/messages", headers=auth_header(user), params=params)


async def rows(case_id):
    async with AsyncSessionLocal() as fresh:
        return list((await fresh.execute(
            select(Message).where(Message.case_id == case_id).order_by(Message.id))).scalars().all())


# --- who and when ---------------------------------------------------------------

@pytest.mark.parametrize("status", OPEN, ids=lambda s: s.value)
async def test_both_sides_can_talk_while_the_case_is_being_worked_on(client, db_session, status):
    lawyer, advocate, case = await chat(db_session, status)
    assert (await send(client, lawyer, case, "Please share the FIR")).status_code == 201
    assert (await send(client, advocate, case, "Sharing it now")).status_code == 201
    thread = (await page(client, lawyer, case)).json()
    assert [m["body"] for m in thread["messages"] if m["kind"] == "text"] == ["Please share the FIR", "Sharing it now"]
    assert thread["open"] is True


async def test_a_completed_case_keeps_its_chat_but_read_only(client, db_session):
    lawyer, advocate, case = await chat(db_session, CaseStatus.COMPLETED)
    await seed_original(db_session, case, uploader=lawyer)
    db_session.add(Message(case_id=case.id, sender_id=lawyer.id, kind="text", body="Thanks"))
    await db_session.commit()
    for user in (lawyer, advocate):
        thread = (await page(client, user, case)).json()
        assert thread["open"] is False and thread["messages"][0]["body"] == "Thanks"
        resp = await send(client, user, case)
        assert resp.status_code == 409 and "read-only" in resp.json()["detail"]


@pytest.mark.parametrize("status", NO_CHAT, ids=lambda s: s.value)
async def test_there_is_no_chat_before_acceptance_or_after_a_rejection(client, db_session, status):
    lawyer, advocate, case = await chat(db_session, status)
    for user in (lawyer, advocate):
        assert (await page(client, user, case)).status_code == 409
        assert (await send(client, user, case)).status_code == 409
        assert (await client.post(f"/cases/{case.id}/read", headers=auth_header(user), json={"last_read_message_id": 1})).status_code == 409
    assert await rows(case.id) == []


async def test_a_draft_case_does_not_exist_to_the_advocate_even_for_chat(client, db_session):
    lawyer, advocate, case = await chat(db_session, CaseStatus.DRAFT)
    assert (await page(client, advocate, case)).status_code == 404
    assert (await send(client, advocate, case)).status_code == 404


async def test_only_the_people_on_the_case_are_in_its_chat(client, db_session):
    lawyer, advocate, case = await chat(db_session, CaseStatus.QUOTED)
    other_lawyer = await make_user(db_session, role_name="junior_lawyer")
    clerk = await make_user(db_session, role_name="clerk")  # can *see* the case, isn't in the chat
    accountant = await make_user(db_session, role_name="accountant")
    await send(client, lawyer, case, "private")
    for outsider in (other_lawyer, clerk, accountant):
        assert (await page(client, outsider, case)).status_code == 403
        assert (await send(client, outsider, case)).status_code == 403
        assert (await client.post(f"/cases/{case.id}/read", headers=auth_header(outsider), json={"last_read_message_id": 1})).status_code == 403
    assert (await client.get(f"/cases/{case.id}", headers=auth_header(clerk))).status_code == 200


# --- sending --------------------------------------------------------------------

async def test_a_message_is_trimmed_and_attributed(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    resp = await send(client, lawyer, case, "  Hello\x00 there  \n")
    out = resp.json()
    assert out["body"] == "Hello there" and out["kind"] == "text"
    assert out["sender_id"] == str(lawyer.id) and out["sender_name"] == lawyer.full_name
    assert out["attachments"] == [] and isinstance(out["id"], int)


@pytest.mark.parametrize("body", [None, "", "   \n ", "\x00"])
async def test_an_empty_message_is_refused(client, db_session, body):
    lawyer, advocate, case = await chat(db_session)
    assert (await send(client, lawyer, case, body)).status_code == 422
    assert await rows(case.id) == []


async def test_the_message_length_limit_is_4000_characters(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    assert (await send(client, lawyer, case, "x" * 4000)).status_code == 201
    assert (await send(client, lawyer, case, "x" * 4001)).status_code == 422
    missing_id = await client.post(f"/cases/{case.id}/messages", headers=auth_header(lawyer), json={"body": "hi"})
    assert missing_id.status_code == 422


async def test_text_is_stored_as_written_never_interpreted(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    nasty = "<script>alert(1)</script> & 'quotes' \"too\""
    assert (await send(client, lawyer, case, nasty)).json()["body"] == nasty


async def test_sending_the_same_client_id_twice_posts_once(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    payload = {"client_id": str(uuid.uuid4()), "body": "Are you there?"}
    first = await client.post(f"/cases/{case.id}/messages", headers=auth_header(lawyer), json=payload)
    again = await client.post(f"/cases/{case.id}/messages", headers=auth_header(lawyer), json=payload)
    assert (first.status_code, again.status_code) == (201, 200)
    assert first.json()["id"] == again.json()["id"]
    assert len([m for m in await rows(case.id) if m.kind == "text"]) == 1


async def test_simultaneous_retries_still_post_once(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    payload = {"client_id": str(uuid.uuid4()), "body": "double tap"}
    results = await asyncio.gather(*[
        client.post(f"/cases/{case.id}/messages", headers=auth_header(lawyer), json=payload) for _ in range(4)
    ])
    assert sorted(r.status_code for r in results) == [200, 200, 200, 201]
    assert len({r.json()["id"] for r in results}) == 1
    assert len([m for m in await rows(case.id) if m.kind == "text"]) == 1


async def test_a_client_id_belongs_to_one_case_and_one_sender(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    second = await make_case(db_session, lawyer, status=CaseStatus.ACCEPTED)
    shared = str(uuid.uuid4())
    ok = await client.post(f"/cases/{case.id}/messages", headers=auth_header(lawyer), json={"client_id": shared, "body": "a"})
    reused = await client.post(f"/cases/{second.id}/messages", headers=auth_header(lawyer), json={"client_id": shared, "body": "b"})
    assert ok.status_code == 201 and reused.status_code == 409
    # Another person may use the same value: ids are per sender.
    other = await client.post(f"/cases/{case.id}/messages", headers=auth_header(advocate), json={"client_id": shared, "body": "c"})
    assert other.status_code == 201


async def test_thirty_messages_a_minute_is_the_limit(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    codes = [(await send(client, lawyer, case, f"m{i}")).status_code for i in range(31)]
    assert codes[:30] == [201] * 30 and codes[30] == 429


# --- files in a message -----------------------------------------------------------

async def _attach(client, fake_store, user, case, files):
    """Sign, 'upload' and return the attachments list for a send."""
    resp = await client.post(
        f"/cases/{case.id}/attachments/upload-urls", headers=auth_header(user),
        json={"files": [{"filename": n, "content_type": t, "size": len(b)} for n, t, b in files]},
    )
    assert resp.status_code == 200, resp.text
    attachments = []
    for target, (name, _, data) in zip(resp.json()["files"], files):
        assert target["storage_key"].startswith(f"cases/{case.id}/")
        fake_store.put(target["storage_key"], data)
        attachments.append({"storage_key": target["storage_key"], "original_filename": name})
    return attachments


async def test_a_message_can_carry_files_and_both_sides_can_open_them(client, db_session, fake_store):
    lawyer, advocate, case = await chat(db_session)
    atts = await _attach(client, fake_store, lawyer, case, [
        ("fir.pdf", "application/pdf", make_pdf(1)), ("scene.png", "image/png", PNG)])

    resp = await send(client, lawyer, case, "FIR and photo", attachments=atts)
    out = resp.json()
    assert resp.status_code == 201 and out["kind"] == "file" and out["body"] == "FIR and photo"
    assert [a["filename"] for a in out["attachments"]] == ["fir.pdf", "scene.png"]
    assert "storage_key" not in out["attachments"][0]

    async with AsyncSessionLocal() as fresh:
        docs = (await fresh.execute(select(CaseDocument).where(CaseDocument.case_id == case.id))).scalars().all()
    assert {d.type for d in docs} == {DocumentType.SUPPORTING}
    for user in (lawyer, advocate):
        dl = await client.get(f"/documents/{out['attachments'][0]['document_id']}/download-url", headers=auth_header(user))
        assert dl.status_code == 200


async def test_a_message_can_be_only_files(client, db_session, fake_store):
    lawyer, advocate, case = await chat(db_session)
    atts = await _attach(client, fake_store, advocate, case, [("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", b"PK\x03\x04" + b"0" * 50)])
    out = (await send(client, advocate, case, None, attachments=atts)).json()
    assert out["kind"] == "file" and out["body"] is None


async def test_files_shared_in_chat_are_hidden_from_a_clerk(client, db_session, fake_store):
    lawyer, advocate, case = await chat(db_session)
    clerk = await make_user(db_session, role_name="clerk")
    atts = await _attach(client, fake_store, lawyer, case, [("fir.pdf", "application/pdf", make_pdf(1))])
    doc_id = (await send(client, lawyer, case, "x", attachments=atts)).json()["attachments"][0]["document_id"]

    assert (await client.get(f"/documents/{doc_id}/download-url", headers=auth_header(clerk))).status_code == 403
    listed = (await client.get(f"/documents/case/{case.id}", headers=auth_header(clerk))).json()
    assert doc_id not in [d["id"] for d in listed]
    mine = (await client.get(f"/documents/case/{case.id}", headers=auth_header(lawyer))).json()
    assert doc_id in [d["id"] for d in mine]


async def test_no_more_than_five_files_a_message(client, db_session, fake_store):
    lawyer, advocate, case = await chat(db_session)
    six = [{"filename": f"{i}.png", "content_type": "image/png", "size": 10} for i in range(6)]
    assert (await client.post(f"/cases/{case.id}/attachments/upload-urls", headers=auth_header(lawyer), json={"files": six})).status_code == 422
    fives = await _attach(client, fake_store, lawyer, case, [(f"{i}.png", "image/png", PNG) for i in range(5)])
    assert (await send(client, lawyer, case, "five", attachments=fives)).status_code == 201
    too_many = fives + [{"storage_key": f"cases/{case.id}/x", "original_filename": "6.png"}]
    assert (await send(client, lawyer, case, "six", attachments=too_many)).status_code == 422


async def test_one_bad_file_stops_the_whole_message_and_cleans_up(client, db_session, fake_store):
    lawyer, advocate, case = await chat(db_session)
    good = await _attach(client, fake_store, lawyer, case, [("ok.pdf", "application/pdf", make_pdf(1))])
    fake_key = fake_store.put(f"cases/{case.id}/{uuid.uuid4()}_fake.png", make_pdf(1))  # a PDF called .png
    resp = await send(client, lawyer, case, "two files", attachments=good + [{"storage_key": fake_key, "original_filename": "fake.png"}])
    assert resp.status_code == 422 and "fake.png" in resp.json()["detail"]
    assert await rows(case.id) == []
    assert good[0]["storage_key"] not in fake_store.objects and fake_key not in fake_store.objects
    async with AsyncSessionLocal() as fresh:
        assert (await fresh.execute(select(CaseDocument.id).where(CaseDocument.case_id == case.id))).first() is None


async def test_retrying_a_message_with_files_does_not_need_the_files_again(client, db_session, fake_store):
    lawyer, advocate, case = await chat(db_session)
    atts = await _attach(client, fake_store, lawyer, case, [("fir.pdf", "application/pdf", make_pdf(1))])
    payload = {"client_id": str(uuid.uuid4()), "body": "with file", "attachments": atts}
    first = await client.post(f"/cases/{case.id}/messages", headers=auth_header(lawyer), json=payload)
    fake_store.objects.clear()  # whatever happened to the object, a replay must not re-verify
    again = await client.post(f"/cases/{case.id}/messages", headers=auth_header(lawyer), json=payload)
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]


async def test_attachment_uploads_are_only_for_an_open_chat(client, db_session):
    lawyer, advocate, case = await chat(db_session, CaseStatus.COMPLETED)
    resp = await client.post(f"/cases/{case.id}/attachments/upload-urls", headers=auth_header(lawyer),
                             json={"files": [{"filename": "a.pdf", "content_type": "application/pdf", "size": 10}]})
    assert resp.status_code == 409


# --- paging ---------------------------------------------------------------------

async def test_history_pages_backwards_and_a_poll_asks_for_what_is_new(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    db_session.add_all([Message(case_id=case.id, sender_id=lawyer.id, kind="text", body=f"m{i}") for i in range(45)])
    await db_session.commit()

    latest = (await page(client, lawyer, case)).json()
    bodies = [m["body"] for m in latest["messages"]]
    assert bodies == [f"m{i}" for i in range(15, 45)] and latest["has_more"] is True   # oldest first

    older = (await page(client, lawyer, case, before=latest["messages"][0]["id"])).json()
    assert [m["body"] for m in older["messages"]] == [f"m{i}" for i in range(15)] and older["has_more"] is False

    newest_id = latest["messages"][-1]["id"]
    assert (await page(client, lawyer, case, after=newest_id)).json()["messages"] == []
    await send(client, advocate, case, "fresh")
    fresh = (await page(client, lawyer, case, after=newest_id)).json()
    assert [m["body"] for m in fresh["messages"]] == ["fresh"]

    assert len((await page(client, lawyer, case, limit=5)).json()["messages"]) == 5
    assert (await page(client, lawyer, case, limit=101)).status_code == 422


# --- read state -------------------------------------------------------------------

async def test_reading_moves_a_cursor_that_only_goes_forward_and_is_visible_to_the_other_side(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    ids = [(await send(client, advocate, case, f"m{i}")).json()["id"] for i in range(3)]
    before = (await page(client, lawyer, case)).json()
    assert before["my_last_read_id"] == 0 and before["other_last_read_id"] >= ids[-1]  # advocate has seen what they sent

    read = await client.post(f"/cases/{case.id}/read", headers=auth_header(lawyer), json={"last_read_message_id": ids[1]})
    assert read.json() == {"last_read_message_id": ids[1]}
    back = await client.post(f"/cases/{case.id}/read", headers=auth_header(lawyer), json={"last_read_message_id": ids[0]})
    assert back.json()["last_read_message_id"] == ids[0]           # the request is accepted…
    assert (await page(client, lawyer, case)).json()["my_last_read_id"] == ids[1]   # …but the cursor didn't retreat
    beyond = await client.post(f"/cases/{case.id}/read", headers=auth_header(lawyer), json={"last_read_message_id": 10**9})
    assert beyond.json()["last_read_message_id"] == ids[-1]        # can't run ahead of the newest message

    seen_by_lawyer = (await page(client, advocate, case)).json()["other_last_read_id"]
    assert seen_by_lawyer == ids[-1]


async def test_a_message_you_sent_is_not_unread_to_you(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    await send(client, lawyer, case, "mine")
    listed = {c["id"]: c for c in (await client.get("/cases", headers=auth_header(lawyer))).json()}
    assert listed[str(case.id)]["unread_count"] == 0
    theirs = {c["id"]: c for c in (await client.get("/cases", headers=auth_header(advocate))).json()}
    assert theirs[str(case.id)]["unread_count"] == 1


async def test_the_cases_list_carries_last_message_unread_count_and_whose_turn_it_is(client, db_session):
    lawyer, advocate, case = await chat(db_session, CaseStatus.ACCEPTED)
    quiet = await make_case(db_session, lawyer, status=CaseStatus.REVIEW_FEE_PAID)
    await send(client, advocate, case, "x" * 120)
    await send(client, advocate, case, "Got the FIR?")

    mine = {c["id"]: c for c in (await client.get("/cases", headers=auth_header(lawyer))).json()}
    chatty = mine[str(case.id)]
    assert chatty["unread_count"] == 2          # the case was created already accepted: just the two messages
    assert chatty["last_message"]["preview"] == "Got the FIR?" and chatty["last_message"]["sender_name"] == advocate.full_name
    assert mine[str(quiet.id)]["last_message"] is None and mine[str(quiet.id)]["unread_count"] == 0

    await client.post(f"/cases/{case.id}/read", headers=auth_header(lawyer), json={"last_read_message_id": 10**9})
    again = {c["id"]: c for c in (await client.get("/cases", headers=auth_header(lawyer))).json()}
    assert again[str(case.id)]["unread_count"] == 0


TURNS = {  # status -> (lawyer's view, advocate's view)
    CaseStatus.DRAFT: ("you", "them"), CaseStatus.SUBMITTED: ("you", "them"),
    CaseStatus.REVIEW_FEE_PAID: ("them", "you"), CaseStatus.ACCEPTED: ("them", "you"),
    CaseStatus.QUOTED: ("you", "them"), CaseStatus.DELIVERED: ("you", "them"),
    CaseStatus.REVISION_REQUESTED: ("them", "you"),
    CaseStatus.REJECTED: ("none", "none"), CaseStatus.COMPLETED: ("none", "none"),
}


@pytest.mark.parametrize("status", list(TURNS), ids=lambda s: s.value)
async def test_whose_turn_it_is_for_every_status(client, db_session, status):
    lawyer, advocate, case = await chat(db_session, status)
    for user, expected in ((lawyer, TURNS[status][0]), (advocate, TURNS[status][1])):
        if status == CaseStatus.DRAFT and user is advocate:
            continue  # the advocate can't list a draft at all
        listed = {c["id"]: c for c in (await client.get("/cases", headers=auth_header(user))).json()}
        assert listed[str(case.id)]["turn"] == expected


# --- the lines the server writes ----------------------------------------------------

async def _kinds(client, user, case):
    return [(m["kind"], m["meta"].get("event")) for m in (await page(client, user, case)).json()["messages"]]


async def test_accepting_a_case_opens_the_chat_with_a_system_line(client, db_session):
    lawyer, advocate, case = await chat(db_session, CaseStatus.REVIEW_FEE_PAID)
    assert (await client.patch(f"/cases/{case.id}/decision", headers=auth_header(advocate), json={"accept": True})).status_code == 200
    thread = (await page(client, lawyer, case)).json()["messages"]
    assert [(m["kind"], m["sender_id"], m["meta"]["event"]) for m in thread] == [("system", None, "accepted")]
    assert "accepted" in thread[0]["body"]


async def test_declining_a_case_writes_nothing_because_there_is_no_chat(client, db_session):
    lawyer, advocate, case = await chat(db_session, CaseStatus.REVIEW_FEE_PAID)
    await client.patch(f"/cases/{case.id}/decision", headers=auth_header(advocate), json={"accept": False, "rejection_reason": "Out of scope"})
    assert await rows(case.id) == []


async def test_the_quote_is_a_card_in_the_thread_and_never_leaks_the_file(client, db_session, fake_store):
    lawyer, advocate, case = await chat(db_session)
    key = fake_store.put_pdf(case, pages=8)
    body = {"draft": {"storage_key": key, "original_filename": "bail.pdf"}, "amount_inr": 2500, "note": "Includes annexures"}
    assert (await client.post(f"/cases/{case.id}/quote", headers=auth_header(advocate), json=body)).status_code == 201

    card = [m for m in (await page(client, lawyer, case)).json()["messages"] if m["kind"] == "quote"][0]
    assert card["body"] == "Quote sent: ₹2,500"
    meta = card["meta"]
    assert (meta["amount_inr"], meta["version"], meta["updated"], meta["note"]) == (2500, 1, False, "Includes annexures")
    assert meta["draft"]["filename"] == "bail.pdf" and meta["draft"]["page_count"] == 8
    assert key not in str(card) and "storage_key" not in str(card)

    key2 = fake_store.put_pdf(case, pages=9)
    await client.post(f"/cases/{case.id}/quote", headers=auth_header(advocate),
                      json={"draft": {"storage_key": key2, "original_filename": "bail.pdf"}, "amount_inr": 3000})
    cards = [m for m in (await page(client, lawyer, case)).json()["messages"] if m["kind"] == "quote"]
    assert [c["body"] for c in cards] == ["Quote sent: ₹2,500", "Quote updated: ₹3,000"]
    assert cards[1]["meta"]["updated"] is True


async def test_paying_refunding_and_completing_are_all_written_into_the_thread(client, db_session, fake_store, fake_razorpay):
    lawyer, advocate, case = await chat(db_session)
    key = fake_store.put_pdf(case)
    await client.post(f"/cases/{case.id}/quote", headers=auth_header(advocate),
                      json={"draft": {"storage_key": key, "original_filename": "d.pdf"}, "amount_inr": 2500})
    order = (await client.post(f"/cases/{case.id}/quote/pay", headers=auth_header(lawyer))).json()

    body, headers = signed_webhook("payment.captured", {"id": "pay_1", "order_id": order["razorpay_order_id"], "amount": 250000, "currency": "INR"})
    assert (await client.post("/webhooks/razorpay", content=body, headers=headers)).status_code == 200
    body, headers = signed_webhook("refund.processed", {"payment_id": "pay_1"}, key="refund")
    assert (await client.post("/webhooks/razorpay", content=body, headers=headers)).status_code == 200

    thread = (await page(client, lawyer, case)).json()["messages"]
    events = [(m["kind"], m["meta"].get("event")) for m in thread]
    assert events == [("quote", None), ("system", "quote_paid"), ("system", "quote_refunded")]
    assert "₹2,500" in thread[1]["body"] and "unlocked" in thread[1]["body"]
    assert "locked again" in thread[2]["body"]
    assert thread[1]["sender_id"] is None          # written by the webhook, not by a person


async def test_changes_new_versions_and_completion_are_written_into_the_thread(client, db_session, fake_store):
    lawyer, advocate, case = await chat(db_session, CaseStatus.DELIVERED)
    await seed_draft(db_session, case, uploader=advocate)
    assert (await client.post(f"/cases/{case.id}/revision", headers=auth_header(lawyer), json={"reason": "Fix the annexure list"})).status_code == 200
    v2 = fake_store.put_pdf(case, pages=4)
    assert (await client.post(f"/cases/{case.id}/drafts", headers=auth_header(advocate), json={"storage_key": v2, "original_filename": "v2.pdf"})).status_code == 201
    assert (await client.post(f"/cases/{case.id}/approve", headers=auth_header(lawyer))).status_code == 200

    thread = (await page(client, lawyer, case)).json()["messages"]
    assert [(m["kind"], m["meta"].get("event")) for m in thread] == [
        ("system", "changes_requested"), ("draft", None), ("system", "completed")]
    assert thread[0]["body"] == "Changes requested: Fix the annexure list"
    assert thread[1]["meta"]["version"] == 2 and thread[1]["meta"]["page_count"] == 4
    assert (await send(client, lawyer, case)).status_code == 409   # and now it is read-only


async def test_whoever_caused_an_event_has_already_seen_it(client, db_session):
    lawyer, advocate, case = await chat(db_session, CaseStatus.DELIVERED)
    await client.post(f"/cases/{case.id}/revision", headers=auth_header(lawyer), json={"reason": "Please fix it"})
    by_id = {c["id"]: c for user in (lawyer,) for c in (await client.get("/cases", headers=auth_header(user))).json()}
    assert by_id[str(case.id)]["unread_count"] == 0
    theirs = {c["id"]: c for c in (await client.get("/cases", headers=auth_header(advocate))).json()}
    assert theirs[str(case.id)]["unread_count"] == 1


# --- notifications ------------------------------------------------------------------

async def _notes(user_id):
    async with AsyncSessionLocal() as fresh:
        return list((await fresh.execute(
            select(Notification).where(Notification.user_id == user_id, Notification.kind == "chat_message")
            .order_by(Notification.created_at))).scalars().all())


async def test_a_message_notifies_the_other_side_once_per_unread_run(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    await send(client, lawyer, case, "First question")
    notes = await _notes(advocate.id)
    assert len(notes) == 1 and notes[0].case_id == case.id and not notes[0].is_read
    assert notes[0].message == f"{lawyer.full_name} on '{case.title}': First question"
    assert await _notes(lawyer.id) == []                                  # not the sender

    await send(client, lawyer, case, "Second")
    await send(client, lawyer, case, "Third")
    notes = await _notes(advocate.id)
    assert len(notes) == 1 and notes[0].message == f"3 new messages on '{case.title}'"

    await client.post(f"/cases/{case.id}/read", headers=auth_header(advocate), json={"last_read_message_id": 10**9})
    assert (await _notes(advocate.id))[0].is_read is True
    await send(client, lawyer, case, "After they looked")
    notes = await _notes(advocate.id)
    assert len(notes) == 2 and notes[1].is_read is False


async def test_the_advocate_now_notifies_the_lawyer_too(client, db_session):
    lawyer, advocate, case = await chat(db_session)
    await send(client, advocate, case, "Please send the affidavit")
    assert len(await _notes(lawyer.id)) == 1
