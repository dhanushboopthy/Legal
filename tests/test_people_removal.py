"""Removing someone from the service and bringing them back later."""
from sqlalchemy import select, text

from app.core.security import hash_password
from app.models.audit_log import AuditLog
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services import token_service
from tests.conftest import auth_header, make_case, make_user


async def _lawyer_with_password(db_session, email, password="a long password 123"):
    user = await make_user(db_session, role_name="junior_lawyer", email=email)
    user.hashed_password = hash_password(password)
    await db_session.commit()
    return user, password


async def _sign_in(client, email, password):
    return await client.post("/auth/login", data={"username": email, "password": password})


async def test_a_removed_person_is_signed_out_and_cannot_sign_back_in(client, db_session):
    admin = await make_user(db_session, role_name="super_admin")
    lawyer, password = await _lawyer_with_password(db_session, "removed@example.com")
    pair = await token_service.issue_tokens(db_session, lawyer.id)
    await db_session.commit()

    resp = await client.patch(f"/users/{lawyer.id}/remove", headers=auth_header(admin))
    assert resp.status_code == 200, resp.text
    assert resp.json()["removed_at"] is not None and resp.json()["is_active"] is False

    # Every session is gone, the access token they hold stops working (even
    # for /users/me, which would otherwise show the pending screen), and
    # the right password still doesn't let them in.
    assert (await client.post("/auth/refresh", json={"refresh_token": pair.refresh_token})).status_code == 401
    for path in ("/users/me", "/cases"):
        r = await client.get(path, headers=auth_header(lawyer))
        assert r.status_code == 403 and "removed" in r.json()["detail"]
    login = await _sign_in(client, "removed@example.com", password)
    assert login.status_code == 403 and "removed" in login.json()["detail"]

    actions = [a for (a,) in (await db_session.execute(select(AuditLog.action))).all()]
    assert "user.removed" in actions


async def test_restoring_brings_them_back_with_their_cases(client, db_session):
    admin = await make_user(db_session, role_name="super_admin")
    lawyer, password = await _lawyer_with_password(db_session, "back@example.com")
    case = await make_case(db_session, lawyer)

    await client.patch(f"/users/{lawyer.id}/remove", headers=auth_header(admin))
    resp = await client.patch(f"/users/{lawyer.id}/restore", headers=auth_header(admin))
    assert resp.status_code == 200 and resp.json()["removed_at"] is None and resp.json()["is_active"] is True

    assert (await _sign_in(client, "back@example.com", password)).status_code == 200
    cases = (await client.get("/cases", headers=auth_header(lawyer))).json()
    assert str(case.id) in str(cases)


async def test_you_cannot_remove_yourself(client, db_session):
    admin = await make_user(db_session, role_name="super_admin")
    resp = await client.patch(f"/users/{admin.id}/remove", headers=auth_header(admin))
    assert resp.status_code == 409


async def test_the_last_person_who_manages_people_cannot_be_removed(client, db_session):
    # Only two admins exist in this test's world: each can remove the other
    # once, but never leave nobody able to manage people.
    await db_session.execute(text(
        "update users set removed_at = now(), is_active = false where role_id in "
        "(select id from roles where 'user:manage' = any(permissions))"
    ))
    await db_session.commit()
    first = await make_user(db_session, role_name="super_admin")
    second = await make_user(db_session, role_name="super_admin")

    assert (await client.patch(f"/users/{second.id}/remove", headers=auth_header(first))).status_code == 200
    third = await make_user(db_session, role_name="super_admin")
    assert (await client.patch(f"/users/{third.id}/remove", headers=auth_header(first))).status_code == 200
    # `first` is now the only one left; nobody else can remove them, and
    # they can't remove themselves.
    assert (await client.patch(f"/users/{first.id}/remove", headers=auth_header(first))).status_code == 409


async def test_a_removed_admin_cannot_be_the_one_left_managing(client, db_session):
    await db_session.execute(text(
        "update users set removed_at = now(), is_active = false where role_id in "
        "(select id from roles where 'user:manage' = any(permissions))"
    ))
    await db_session.commit()
    first = await make_user(db_session, role_name="super_admin")
    second = await make_user(db_session, role_name="super_admin")
    # Removing `second` leaves `first`, so it's allowed...
    assert (await client.patch(f"/users/{second.id}/remove", headers=auth_header(first))).status_code == 200
    # ...and `second` (now removed) can't act at all.
    assert (await client.patch(f"/users/{first.id}/remove", headers=auth_header(second))).status_code == 403


async def test_approve_does_not_undo_a_removal(client, db_session):
    admin = await make_user(db_session, role_name="super_admin")
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    await client.patch(f"/users/{lawyer.id}/remove", headers=auth_header(admin))
    assert (await client.patch(f"/users/{lawyer.id}/approve", headers=auth_header(admin))).status_code == 409


async def test_removed_people_get_no_pending_approval_reminders(db_session, monkeypatch):
    from datetime import datetime, timedelta, timezone

    from app.services import maintenance_service

    admin = await make_user(db_session, role_name="super_admin")
    waiting = await make_user(db_session, role_name="junior_lawyer", is_active=False)
    waiting.is_verified = True
    waiting.removed_at = datetime.now(timezone.utc)
    waiting.created_at = datetime.now(timezone.utc) - timedelta(days=30)
    await db_session.commit()

    sent = []
    async def fake_send(*args, **kwargs):
        sent.append(args)
    monkeypatch.setattr(maintenance_service.email_service, "send_email", fake_send)

    await maintenance_service.remind_stale_pending_approvals(db_session)
    await db_session.refresh(waiting)
    assert waiting.pending_reminder_sent_at is None and sent == []


async def test_refresh_tokens_are_revoked_on_removal(client, db_session):
    admin = await make_user(db_session, role_name="super_admin")
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    await token_service.issue_tokens(db_session, lawyer.id)
    await token_service.issue_tokens(db_session, lawyer.id)
    await db_session.commit()
    await client.patch(f"/users/{lawyer.id}/remove", headers=auth_header(admin))
    live = (await db_session.execute(
        select(RefreshToken).where(RefreshToken.user_id == lawyer.id, RefreshToken.revoked_at.is_(None))
    )).scalars().all()
    assert live == []
    assert (await db_session.get(User, lawyer.id)) is not None  # nothing is deleted
