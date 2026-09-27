"""Revocable refresh tokens, sign-in lockout, password reset, password rules."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.security import hash_password, verify_password
from app.models.audit_log import AuditLog
from app.models.email_otp import EmailOtp
from app.models.refresh_token import RefreshToken
from app.services import email_service, otp_service
from tests.conftest import make_user

PASSWORD = "a sensible passphrase"


async def _password_user(db, *, email=None, password=PASSWORD):
    user = await make_user(db, is_active=True, email=email)
    user.hashed_password = hash_password(password)
    await db.commit()
    return user


async def _login(client, email, password=PASSWORD):
    return await client.post("/auth/login", data={"username": email, "password": password})


# --- refresh rotation and revocation -------------------------------------------------

async def test_refresh_rotates_the_token(client, db_session):
    user = await _password_user(db_session)
    first = (await _login(client, user.email)).json()["refresh_token"]

    resp = await client.post("/auth/refresh", json={"refresh_token": first})
    assert resp.status_code == 200
    second = resp.json()["refresh_token"]
    assert second != first
    assert (await client.post("/auth/refresh", json={"refresh_token": second})).status_code == 200


async def test_replaying_a_rotated_token_ends_the_whole_session(client, db_session):
    user = await _password_user(db_session)
    stolen = (await _login(client, user.email)).json()["refresh_token"]
    current = (await client.post("/auth/refresh", json={"refresh_token": stolen})).json()["refresh_token"]

    # Pretend the rotation happened well outside the two-tabs grace window.
    await db_session.execute(
        RefreshToken.__table__.update()
        .where(RefreshToken.revoked_at.is_not(None))
        .values(revoked_at=datetime.now(timezone.utc) - timedelta(minutes=5))
    )
    await db_session.commit()

    replay = await client.post("/auth/refresh", json={"refresh_token": stolen})
    assert replay.status_code == 401
    # The legitimate holder is signed out too: that family is burned.
    assert (await client.post("/auth/refresh", json={"refresh_token": current})).status_code == 401


async def test_two_tabs_refreshing_at_once_both_succeed(client, db_session):
    user = await _password_user(db_session)
    token = (await _login(client, user.email)).json()["refresh_token"]
    a = await client.post("/auth/refresh", json={"refresh_token": token})
    b = await client.post("/auth/refresh", json={"refresh_token": token})
    assert a.status_code == 200 and b.status_code == 200


async def test_logout_revokes_the_refresh_token(client, db_session):
    user = await _password_user(db_session)
    token = (await _login(client, user.email)).json()["refresh_token"]

    assert (await client.post("/auth/logout", json={"refresh_token": token})).status_code == 204
    assert (await client.post("/auth/refresh", json={"refresh_token": token})).status_code == 401


async def test_signing_out_ends_the_grace_window_too(client, db_session):
    user = await _password_user(db_session)
    old = (await _login(client, user.email)).json()["refresh_token"]
    new = (await client.post("/auth/refresh", json={"refresh_token": old})).json()["refresh_token"]
    assert (await client.post("/auth/logout", json={"refresh_token": new})).status_code == 204
    # Seconds later, well inside the two-tabs window: still refused.
    assert (await client.post("/auth/refresh", json={"refresh_token": old})).status_code == 401


async def test_logout_with_garbage_is_still_204(client, db_session):
    assert (await client.post("/auth/logout", json={"refresh_token": "nonsense"})).status_code == 204


async def test_a_refresh_token_with_no_record_is_refused(client, db_session):
    from app.core.security import create_refresh_token
    import uuid

    user = await _password_user(db_session)
    forged = create_refresh_token(user.id, jti=uuid.uuid4())
    assert (await client.post("/auth/refresh", json={"refresh_token": forged})).status_code == 401


# --- lockout -------------------------------------------------------------------------

async def test_five_wrong_passwords_pause_sign_in(client, db_session):
    user = await _password_user(db_session)
    for _ in range(5):
        assert (await _login(client, user.email, "wrong password!")).status_code == 401

    # Even the right password is refused while paused, and the message says why.
    resp = await _login(client, user.email)
    assert resp.status_code == 401
    assert "paused" in resp.json()["detail"]

    actions = (await db_session.execute(
        select(AuditLog.action).where(AuditLog.user_id == user.id)
    )).scalars().all()
    assert "user.login_locked" in actions


async def test_the_pause_ends_by_itself(client, db_session):
    user = await _password_user(db_session)
    user.locked_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()
    assert (await _login(client, user.email)).status_code == 200


async def test_a_successful_sign_in_resets_the_count(client, db_session):
    user = await _password_user(db_session)
    for _ in range(4):
        await _login(client, user.email, "wrong password!")
    assert (await _login(client, user.email)).status_code == 200
    await db_session.refresh(user)
    assert user.failed_login_count == 0


async def test_sign_in_does_not_reveal_who_has_an_account(client, db_session):
    user = await _password_user(db_session)
    google_only = await make_user(db_session, is_active=True)
    google_only.hashed_password = None
    await db_session.commit()

    wrong = await _login(client, user.email, "wrong password!")
    unknown = await _login(client, "nobody-here@example.com")
    google = await _login(client, google_only.email)
    assert wrong.json()["detail"] == unknown.json()["detail"] == google.json()["detail"]


# --- forgot / reset password -----------------------------------------------------------

async def test_forgot_password_is_204_for_an_unknown_email(client, db_session):
    resp = await client.post("/auth/forgot-password", json={"email": "nobody-here@example.com"})
    assert resp.status_code == 204


async def test_reset_password_end_to_end(client, db_session, monkeypatch):
    sent = {}

    async def capture(to_email, code):
        sent["code"] = code

    monkeypatch.setattr(email_service, "send_password_reset_email", capture)

    user = await _password_user(db_session)
    old_session = (await _login(client, user.email)).json()["refresh_token"]
    user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=10)
    await db_session.commit()

    assert (await client.post("/auth/forgot-password", json={"email": user.email})).status_code == 204
    resp = await client.post("/auth/reset-password", json={
        "email": user.email, "code": sent["code"], "new_password": "a brand new phrase",
    })
    assert resp.status_code == 200, resp.text
    assert "access_token" in resp.json()

    # Signed out everywhere else, pause cleared, new password works.
    assert (await client.post("/auth/refresh", json={"refresh_token": old_session})).status_code == 401
    assert (await _login(client, user.email, "a brand new phrase")).status_code == 200


async def test_a_wrong_reset_code_counts_as_an_attempt(client, db_session):
    user = await _password_user(db_session)
    await otp_service.generate_and_store_otp(db_session, user=user, purpose=otp_service.RESET_PASSWORD)
    await db_session.commit()

    resp = await client.post("/auth/reset-password", json={
        "email": user.email, "code": "000000", "new_password": "a brand new phrase",
    })
    assert resp.status_code == 422
    row = (await db_session.execute(select(EmailOtp).where(EmailOtp.user_id == user.id))).scalar_one()
    await db_session.refresh(row)
    assert row.attempts == 1


async def test_a_verification_code_cannot_reset_a_password(client, db_session):
    user = await _password_user(db_session)
    code = await otp_service.generate_and_store_otp(db_session, user=user)  # verify_email purpose
    await db_session.commit()

    resp = await client.post("/auth/reset-password", json={
        "email": user.email, "code": code, "new_password": "a brand new phrase",
    })
    assert resp.status_code == 422


async def test_asking_for_a_reset_code_keeps_a_pending_verification_code(client, db_session):
    user = await _password_user(db_session)
    await otp_service.generate_and_store_otp(db_session, user=user)
    await otp_service.generate_and_store_otp(db_session, user=user, purpose=otp_service.RESET_PASSWORD)
    await db_session.commit()
    purposes = (await db_session.execute(
        select(EmailOtp.purpose).where(EmailOtp.user_id == user.id)
    )).scalars().all()
    assert sorted(purposes) == ["reset_password", "verify_email"]


# --- password rules ------------------------------------------------------------------

async def _register(client, password, email="newlawyer@example.com"):
    return await client.post("/auth/register", json={
        "full_name": "New Lawyer", "email": email, "password": password,
    })


async def test_register_rejects_a_short_password(client, db_session):
    assert (await _register(client, "short1")).status_code == 422


async def test_register_rejects_a_common_password(client, db_session):
    assert (await _register(client, "password123")).status_code == 422


async def test_register_rejects_a_password_containing_the_email(client, db_session):
    assert (await _register(client, "newlawyer-2026!", "newlawyer@example.com")).status_code == 422


async def test_register_rejects_a_password_over_72_bytes(client, db_session):
    assert (await _register(client, "x" * 73)).status_code == 422


async def test_register_accepts_a_passphrase(client, db_session):
    assert (await _register(client, "blue river courtroom")).status_code == 201


# --- migration from passlib ------------------------------------------------------------

def test_hashes_made_by_the_old_library_still_verify():
    legacy = "$2b$12$suBc8GNYpeJOkJqH5U8mgOmnE5wch0dgGyyA03/G5jPgI481TF0V."
    assert verify_password("legacy-password-1", legacy)
    assert not verify_password("something else", legacy)


def test_a_non_bcrypt_value_never_matches():
    assert not verify_password("anything", "not-a-hash")
