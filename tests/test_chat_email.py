"""Emailing people about chat messages they haven't opened."""
from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.models.case import CaseStatus
from app.models.message import Message
from app.services import email_service, maintenance_service
from tests.conftest import AsyncSessionLocal, auth_header, make_case, make_user


@pytest.fixture
def outbox(monkeypatch):
    sent: list[dict] = []

    async def fake_send(to, subject, text, html):
        sent.append({"to": to, "subject": subject, "text": text, "html": html})

    monkeypatch.setattr(email_service, "is_configured", lambda: True)
    monkeypatch.setattr(email_service, "send_email", fake_send)
    monkeypatch.setattr(maintenance_service, "_warned_no_smtp", False)
    return sent


async def world(db, status=CaseStatus.ACCEPTED):
    lawyer = await make_user(db, role_name="junior_lawyer", email="lawyer@example.com")
    advocate = await make_user(db, role_name="super_admin", email="advocate@example.com")
    return lawyer, advocate, await make_case(db, lawyer, status=status, title="Sharma vs Verma")


def say(client, user, case, body="hello"):
    import uuid
    return client.post(f"/cases/{case.id}/messages", headers=auth_header(user),
                       json={"client_id": str(uuid.uuid4()), "body": body})


async def sweep(minutes_from_now):
    async with AsyncSessionLocal() as db:
        return await maintenance_service.email_unread_messages(
            db, now=datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now))


async def test_an_unread_message_is_emailed_after_ten_minutes_without_its_text(client, db_session, outbox):
    lawyer, advocate, case = await world(db_session)
    await say(client, lawyer, case, "The client's confession is in the annexure")

    assert await sweep(5) == 0 and outbox == []                      # too soon
    assert await sweep(11) == 1
    mail = outbox[0]
    assert mail["to"] == "advocate@example.com"                       # the other side, not the sender
    assert f"/cases/{case.id}" in mail["text"] and "1 unread message" in mail["text"]
    assert "Sharma vs Verma" in mail["text"]
    assert "confession" not in mail["text"] + mail["html"] + mail["subject"]
    assert "Sharma" not in mail["subject"]


async def test_a_run_of_unread_messages_is_one_email_with_a_count(client, db_session, outbox):
    lawyer, advocate, case = await world(db_session)
    for i in range(3):
        await say(client, lawyer, case, f"m{i}")
    assert await sweep(11) == 1
    assert "3 unread messages" in outbox[0]["text"]
    assert await sweep(12) == 0                                        # not again for the same messages


async def test_nothing_is_sent_to_someone_who_has_read_it(client, db_session, outbox):
    lawyer, advocate, case = await world(db_session)
    sent = await say(client, lawyer, case)
    await client.post(f"/cases/{case.id}/read", headers=auth_header(advocate),
                      json={"last_read_message_id": sent.json()["id"]})
    assert await sweep(30) == 0 and outbox == []


async def test_new_messages_wait_out_the_gap_before_another_email(client, db_session, outbox):
    lawyer, advocate, case = await world(db_session)
    await say(client, lawyer, case, "first")
    assert await sweep(11) == 1
    await say(client, lawyer, case, "second")
    assert await sweep(25) == 0                                        # within the hour
    assert await sweep(11 + settings.chat_email_min_gap_minutes + 1) == 1
    assert "1 unread message" in outbox[1]["text"] and "second" not in outbox[1]["text"]


async def test_chat_events_written_by_the_server_are_not_emailed(client, db_session, outbox):
    lawyer, advocate, case = await world(db_session, CaseStatus.REVIEW_FEE_PAID)
    await client.patch(f"/cases/{case.id}/decision", headers=auth_header(advocate), json={"accept": True})
    assert await sweep(60) == 0 and outbox == []


async def test_old_unread_messages_are_not_worth_an_email(client, db_session, outbox):
    lawyer, advocate, case = await world(db_session)
    await say(client, lawyer, case)
    assert await sweep(60 * 24 * 8) == 0


async def test_without_smtp_nothing_is_attempted_and_nothing_is_marked_sent(client, db_session, monkeypatch):
    lawyer, advocate, case = await world(db_session)
    await say(client, lawyer, case)
    monkeypatch.setattr(email_service, "is_configured", lambda: False)
    assert await sweep(30) == 0

    sent: list = []
    async def fake_send(*args):
        sent.append(args)
    monkeypatch.setattr(email_service, "is_configured", lambda: True)
    monkeypatch.setattr(email_service, "send_email", fake_send)
    assert await sweep(30) == 1 and len(sent) == 1                     # still owed: it goes out once SMTP exists


async def test_a_failed_send_is_retried_on_the_next_sweep(client, db_session, monkeypatch):
    lawyer, advocate, case = await world(db_session)
    await say(client, lawyer, case)
    calls: list = []

    async def flaky(to, subject, text, html):
        calls.append(to)
        if len(calls) == 1:
            raise ConnectionError("smtp down")

    monkeypatch.setattr(email_service, "is_configured", lambda: True)
    monkeypatch.setattr(email_service, "send_email", flaky)
    assert await sweep(11) == 0
    assert await sweep(12) == 1 and len(calls) == 2


async def test_each_side_is_emailed_about_the_other_sides_messages(client, db_session, outbox):
    lawyer, advocate, case = await world(db_session)
    second = await make_case(db_session, lawyer, status=CaseStatus.ACCEPTED, title="Another case")
    await say(client, lawyer, case, "to the advocate")
    await say(client, advocate, second, "to the lawyer")
    assert await sweep(11) == 2
    assert {m["to"] for m in outbox} == {"lawyer@example.com", "advocate@example.com"}


async def test_replying_counts_as_having_read_what_came_before(client, db_session, outbox):
    lawyer, advocate, case = await world(db_session)
    await say(client, lawyer, case, "question")
    await say(client, advocate, case, "answer")           # the advocate obviously saw the question
    assert await sweep(11) == 1
    assert outbox[0]["to"] == "lawyer@example.com"
