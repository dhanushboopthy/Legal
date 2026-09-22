from sqlalchemy import select

import app.routers.auth as auth_router
from app.core.google_auth import GoogleTokenError
from app.models.user import User
from tests.conftest import make_user


def _claims(**overrides):
    base = {
        "sub": "google-sub-123",
        "email": "googler@example.com",
        "email_verified": True,
        "name": "Googler",
    }
    base.update(overrides)
    return base


async def test_google_login_creates_new_unapproved_but_verified_user(client, db_session, monkeypatch):
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda token: _claims())

    resp = await client.post("/auth/google", json={"id_token": "whatever"})
    # Verified (Google's own verification counts) is enough for a token even
    # before admin approval — a limited session, not full access: GET
    # /users/me works (the pending-approval screen's poll), but a
    # permission-gated route still 403s until an admin approves.
    assert resp.status_code == 200
    token = resp.json()["access_token"]

    me = await client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["is_active"] is False

    gated = await client.get("/users", headers={"Authorization": f"Bearer {token}"})
    assert gated.status_code == 403


async def test_google_login_succeeds_once_active(client, db_session, monkeypatch):
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda token: _claims())

    first = await client.post("/auth/google", json={"id_token": "whatever"})
    assert first.status_code == 200  # creates the (inactive) user as a side effect

    user = (
        await db_session.execute(select(User).where(User.email == "googler@example.com"))
    ).scalar_one()
    assert user.is_verified is True
    assert user.google_sub == "google-sub-123"
    assert user.hashed_password is None
    user.is_active = True
    await db_session.commit()

    second = await client.post("/auth/google", json={"id_token": "whatever"})
    assert second.status_code == 200
    assert "access_token" in second.json()


async def test_google_login_links_existing_password_account_by_email(client, db_session, monkeypatch):
    user = await make_user(db_session, email="linkme@example.com", is_active=True)
    assert user.google_sub is None

    monkeypatch.setattr(
        auth_router, "verify_google_id_token", lambda token: _claims(email="linkme@example.com")
    )
    resp = await client.post("/auth/google", json={"id_token": "whatever"})
    assert resp.status_code == 200

    await db_session.refresh(user)
    assert user.google_sub == "google-sub-123"


async def test_google_login_rejects_unverified_google_email(client, db_session, monkeypatch):
    def _raise(token):
        raise GoogleTokenError("Google account email is not verified")

    monkeypatch.setattr(auth_router, "verify_google_id_token", _raise)

    resp = await client.post("/auth/google", json={"id_token": "whatever"})
    assert resp.status_code == 401
