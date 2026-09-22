"""Pushing chat and status events to connected browsers: who is told, when, and
that a failed request tells nobody."""
import asyncio
import json
import uuid

import pytest

from app.models.case import CaseStatus
from app.services import realtime
from tests.conftest import auth_header, make_case, make_user


@pytest.fixture
def bus(monkeypatch):
    backend = realtime.MemoryBackend()
    monkeypatch.setattr(realtime, "_backend", backend)
    monkeypatch.setattr(realtime, "enabled", True)
    yield backend
    monkeypatch.setattr(realtime, "_backend", None)


class Listener:
    """Stands in for one connected browser."""

    def __init__(self, bus, user):
        self.events: list[dict] = []
        self._task = asyncio.create_task(self._run(bus, user))

    async def _run(self, bus, user):
        async for raw in bus.subscribe(realtime.user_channel(user.id)):
            self.events.append(json.loads(raw))

    async def ready(self):
        await asyncio.sleep(0)  # let the subscription register

    def stop(self):
        self._task.cancel()


async def settle():
    await realtime.drain()
    await asyncio.sleep(0.05)


async def world(db, status=CaseStatus.ACCEPTED):
    lawyer = await make_user(db, role_name="junior_lawyer")
    advocate = await make_user(db, role_name="super_admin")
    clerk = await make_user(db, role_name="clerk")
    other = await make_user(db, role_name="junior_lawyer")
    return lawyer, advocate, clerk, other, await make_case(db, lawyer, status=status)


async def test_a_new_message_reaches_the_two_people_in_the_chat_and_nobody_else(client, db_session, bus):
    lawyer, advocate, clerk, other, case = await world(db_session)
    listeners = {n: Listener(bus, u) for n, u in dict(lawyer=lawyer, advocate=advocate, clerk=clerk, other=other).items()}
    await asyncio.sleep(0)

    resp = await client.post(f"/cases/{case.id}/messages", headers=auth_header(lawyer),
                             json={"client_id": str(uuid.uuid4()), "body": "secret strategy"})
    await settle()

    for who in ("lawyer", "advocate"):
        assert listeners[who].events == [
            {"type": "message.created", "case_id": str(case.id), "message_id": resp.json()["id"]}]
    assert listeners["clerk"].events == [] and listeners["other"].events == []
    assert "secret strategy" not in json.dumps([e for l in listeners.values() for e in l.events])  # ids, never text
    for listener in listeners.values():
        listener.stop()


async def test_a_request_that_fails_tells_nobody(client, db_session, bus):
    lawyer, advocate, clerk, other, case = await world(db_session)
    heard = Listener(bus, advocate)
    await asyncio.sleep(0)

    assert (await client.post(f"/cases/{case.id}/messages", headers=auth_header(lawyer),
                              json={"client_id": str(uuid.uuid4()), "body": "  "})).status_code == 422
    await settle()
    assert heard.events == []
    heard.stop()


async def test_a_retried_message_is_announced_once(client, db_session, bus):
    lawyer, advocate, clerk, other, case = await world(db_session)
    heard = Listener(bus, advocate)
    await asyncio.sleep(0)
    payload = {"client_id": str(uuid.uuid4()), "body": "once"}
    for _ in range(3):
        await client.post(f"/cases/{case.id}/messages", headers=auth_header(lawyer), json=payload)
    await settle()
    assert [e["type"] for e in heard.events] == ["message.created"]
    heard.stop()


async def test_reading_is_announced_to_the_chat(client, db_session, bus):
    lawyer, advocate, clerk, other, case = await world(db_session)
    sent = await client.post(f"/cases/{case.id}/messages", headers=auth_header(advocate),
                             json={"client_id": str(uuid.uuid4()), "body": "hi"})
    await settle()
    heard = Listener(bus, advocate)
    await asyncio.sleep(0)
    await client.post(f"/cases/{case.id}/read", headers=auth_header(lawyer), json={"last_read_message_id": sent.json()["id"]})
    await settle()
    assert heard.events == [{"type": "read.updated", "case_id": str(case.id), "user_id": str(lawyer.id),
                             "last_read_message_id": sent.json()["id"]}]
    heard.stop()


async def test_a_status_change_reaches_everyone_who_lists_the_case(client, db_session, bus):
    lawyer, advocate, clerk, other, case = await world(db_session, CaseStatus.REVIEW_FEE_PAID)
    listeners = {n: Listener(bus, u) for n, u in dict(lawyer=lawyer, advocate=advocate, clerk=clerk, other=other).items()}
    await asyncio.sleep(0)

    await client.patch(f"/cases/{case.id}/decision", headers=auth_header(advocate), json={"accept": True})
    await settle()

    status_events = {n: [e for e in l.events if e["type"] == "case.status_changed"] for n, l in listeners.items()}
    for who in ("lawyer", "advocate", "clerk"):
        assert status_events[who] == [{"type": "case.status_changed", "case_id": str(case.id), "status": "accepted"}]
    assert listeners["other"].events == []
    # The accept line is a chat event: only the two participants hear it.
    assert [e["type"] for e in listeners["clerk"].events] == ["case.status_changed"]
    for listener in listeners.values():
        listener.stop()


async def test_the_advocate_is_not_told_about_a_case_before_its_fee_is_paid(client, db_session, bus):
    lawyer, advocate, clerk, other, case = await world(db_session, CaseStatus.DRAFT)
    from tests.helpers import seed_original
    await seed_original(db_session, case, uploader=lawyer)
    listeners = [Listener(bus, advocate), Listener(bus, lawyer)]
    await asyncio.sleep(0)
    assert (await client.post(f"/cases/{case.id}/submit", headers=auth_header(lawyer))).status_code == 200
    await settle()
    assert listeners[0].events == []
    assert [e["status"] for e in listeners[1].events] == ["submitted"]
    for l in listeners:
        l.stop()


# --- tickets ------------------------------------------------------------------------

async def test_a_ticket_opens_the_socket_once_for_the_person_who_asked(client, db_session, bus):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    resp = await client.post("/ws/ticket", headers=auth_header(lawyer))
    assert resp.status_code == 200 and resp.json()["expires_in_seconds"] == 30
    ticket = resp.json()["ticket"]

    assert await realtime.redeem_ticket(ticket) == lawyer.id
    assert await realtime.redeem_ticket(ticket) is None          # single use
    assert await realtime.redeem_ticket("not-a-ticket") is None
    assert await realtime.redeem_ticket("") is None


async def test_asking_for_a_ticket_needs_a_login(client, db_session, bus):
    assert (await client.post("/ws/ticket")).status_code in (401, 403)


async def test_tickets_are_unguessable_and_distinct(client, db_session, bus):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    tickets = {(await client.post("/ws/ticket", headers=auth_header(lawyer))).json()["ticket"] for _ in range(5)}
    assert len(tickets) == 5 and all(len(t) >= 40 for t in tickets)
