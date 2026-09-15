from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.security import hash_password
from app.models.email_otp import EmailOtp
from app.models.user import User
from app.services import otp_service
from tests.conftest import make_user


async def _register(client, email="otp-test@example.com"):
    resp = await client.post(
        "/auth/register",
        json={"full_name": "OTP Test", "email": email, "password": "supersecret123"},
    )
    assert resp.status_code == 201
    return resp.json()


async def _first_otp(db_session, user_id) -> EmailOtp | None:
    result = await db_session.execute(select(EmailOtp).where(EmailOtp.user_id == user_id))
    return result.scalars().first()


async def test_register_creates_exactly_one_otp_row(client, db_session):
    body = await _register(client)
    otp = await _first_otp(db_session, body["id"])
    assert otp is not None
    assert body["is_verified"] is False


async def test_verify_email_with_correct_code_marks_verified(client, db_session):
    body = await _register(client)
    user = await db_session.get(User, body["id"])
    code = await otp_service.generate_and_store_otp(db_session, user=user)
    await db_session.commit()

    resp = await client.post("/auth/verify-email", json={"email": body["email"], "code": code})
    assert resp.status_code == 200
    assert resp.json()["is_verified"] is True

    assert await _first_otp(db_session, user.id) is None


async def test_verify_email_with_wrong_code_increments_attempts(client, db_session):
    body = await _register(client)

    resp = await client.post("/auth/verify-email", json={"email": body["email"], "code": "000000"})
    assert resp.status_code == 422

    otp = await _first_otp(db_session, body["id"])
    assert otp.attempts == 1


async def test_verify_email_expired_code_rejected(client, db_session):
    body = await _register(client)
    user = await db_session.get(User, body["id"])
    code = await otp_service.generate_and_store_otp(db_session, user=user)
    otp = await _first_otp(db_session, user.id)
    otp.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db_session.commit()

    resp = await client.post("/auth/verify-email", json={"email": user.email, "code": code})
    assert resp.status_code == 422


async def test_verify_email_locks_out_after_max_attempts(client, db_session):
    body = await _register(client)

    for _ in range(5):
        resp = await client.post("/auth/verify-email", json={"email": body["email"], "code": "111111"})
        assert resp.status_code == 422

    resp = await client.post("/auth/verify-email", json={"email": body["email"], "code": "222222"})
    assert resp.status_code == 409


async def test_login_blocked_while_unverified_even_if_active(client, db_session):
    user = await make_user(db_session, is_active=True)
    user.is_verified = False
    user.hashed_password = hash_password("supersecret123")
    await db_session.commit()

    resp = await client.post("/auth/login", data={"username": user.email, "password": "supersecret123"})
    assert resp.status_code == 403
    assert "verify" in resp.json()["detail"].lower()


async def test_resend_otp_replaces_previous_code(client, db_session):
    body = await _register(client)
    user = await db_session.get(User, body["id"])
    first_id = (await _first_otp(db_session, user.id)).id

    resp = await client.post("/auth/resend-otp", json={"email": user.email})
    assert resp.status_code == 204

    rows = (await db_session.execute(select(EmailOtp).where(EmailOtp.user_id == user.id))).scalars().all()
    assert len(rows) == 1
    assert rows[0].id != first_id
