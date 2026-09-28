"""Holding a case over (and resuming it), and profile pictures."""
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.case import Case, CaseStatus
from app.models.message import Message
from app.models.notification import Notification
from tests.conftest import auth_header, make_case, make_user

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 100
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


# --- hold over -------------------------------------------------------------

async def _hold(client, case, advocate, reason="Awaiting the court date"):
    return await client.post(f"/cases/{case.id}/hold", json={"reason": reason}, headers=auth_header(advocate))


async def test_holding_over_pauses_the_case_and_tells_the_lawyer(client, db_session):
    lawyer = await make_user(db_session)
    advocate = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.REVISION_REQUESTED)

    resp = await _hold(client, case, advocate)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "held_over"
    assert resp.json()["hold_reason"] == "Awaiting the court date"

    notes = (await db_session.execute(select(Notification).where(Notification.user_id == lawyer.id))).scalars().all()
    assert any("held over" in n.message for n in notes)
    lines = (await db_session.execute(select(Message).where(Message.case_id == case.id))).scalars().all()
    assert any("held this case over" in (m.body or "") for m in lines)
    actions = (await db_session.execute(select(AuditLog.action))).scalars().all()
    assert "case.held_over" in actions


async def test_resuming_returns_the_case_to_where_it_was(client, db_session):
    lawyer = await make_user(db_session)
    advocate = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.REVISION_REQUESTED)
    await _hold(client, case, advocate)

    resp = await client.post(f"/cases/{case.id}/resume", headers=auth_header(advocate))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "revision_requested"
    assert resp.json()["hold_reason"] is None

    # A second resume has nothing to resume.
    again = await client.post(f"/cases/{case.id}/resume", headers=auth_header(advocate))
    assert again.status_code == 409


async def test_a_held_case_cannot_be_quoted_until_resumed(client, db_session, fake_store):
    lawyer = await make_user(db_session)
    advocate = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.ACCEPTED)
    await _hold(client, case, advocate)

    key = fake_store.put_pdf(case)
    resp = await client.post(
        f"/cases/{case.id}/quote", headers=auth_header(advocate),
        json={"draft": {"storage_key": key, "original_filename": "d.pdf"}, "amount_inr": 500},
    )
    assert resp.status_code == 409
    case_id = case.id
    db_session.expire_all()
    status = (await db_session.execute(select(Case.status).where(Case.id == case_id))).scalar_one()
    assert status == CaseStatus.HELD_OVER


async def test_a_hold_needs_a_reason(client, db_session):
    lawyer = await make_user(db_session)
    advocate = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.ACCEPTED)
    resp = await _hold(client, case, advocate, reason="")
    assert resp.status_code == 422


# --- profile pictures ----------------------------------------------------------

async def _upload(client, user, fake_store, data, content_type="image/jpeg"):
    target = await client.post(
        "/users/me/avatar/upload-url", headers=auth_header(user),
        json={"content_type": content_type, "size": len(data)},
    )
    assert target.status_code == 200, target.text
    key = target.json()["key"]
    fake_store.put(key, data)
    return key


async def test_a_picture_can_be_set_replaced_and_removed(client, db_session, fake_store):
    user = await make_user(db_session)
    first = await _upload(client, user, fake_store, JPEG)
    resp = await client.put("/users/me/avatar", json={"key": first}, headers=auth_header(user))
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar_url"].startswith(f"https://store.test/{first}")

    second = await _upload(client, user, fake_store, PNG, content_type="image/png")
    resp = await client.put("/users/me/avatar", json={"key": second}, headers=auth_header(user))
    assert resp.json()["avatar_url"].startswith(f"https://store.test/{second}")
    assert first in fake_store.deleted, "the old picture is deleted once replaced"

    resp = await client.delete("/users/me/avatar", headers=auth_header(user))
    assert resp.json()["avatar_url"] is None
    assert second in fake_store.deleted


async def test_only_jpeg_or_png_up_to_2mb_is_signed(client, db_session):
    user = await make_user(db_session)
    for body in (
        {"content_type": "image/gif", "size": 100},
        {"content_type": "image/jpeg", "size": 3 * 1024 * 1024},
    ):
        resp = await client.post("/users/me/avatar/upload-url", json=body, headers=auth_header(user))
        assert resp.status_code == 422, body


async def test_a_file_that_is_not_a_picture_is_refused_and_deleted(client, db_session, fake_store):
    user = await make_user(db_session)
    key = await _upload(client, user, fake_store, b"%PDF-1.7 not a picture")
    resp = await client.put("/users/me/avatar", json={"key": key}, headers=auth_header(user))
    assert resp.status_code == 422
    assert key in fake_store.deleted


async def test_someone_elses_picture_cannot_be_claimed(client, db_session, fake_store):
    owner = await make_user(db_session)
    thief = await make_user(db_session)
    key = await _upload(client, owner, fake_store, JPEG)
    resp = await client.put("/users/me/avatar", json={"key": key}, headers=auth_header(thief))
    assert resp.status_code == 422
    assert key not in fake_store.deleted


async def test_the_advocate_sees_the_lawyers_picture_in_the_case_list(client, db_session, fake_store):
    lawyer = await make_user(db_session)
    advocate = await make_user(db_session, role_name="super_admin")
    key = await _upload(client, lawyer, fake_store, JPEG)
    await client.put("/users/me/avatar", json={"key": key}, headers=auth_header(lawyer))
    await make_case(db_session, lawyer, status=CaseStatus.ACCEPTED)

    resp = await client.get("/cases", headers=auth_header(advocate))
    assert resp.json()[0]["junior_lawyer_avatar_url"].startswith(f"https://store.test/{key}")
