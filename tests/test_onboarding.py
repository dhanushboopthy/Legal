"""Phase 5: the bounded admin-approval gate, editable profile, case numbers."""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import create_refresh_token, hash_password
from app.services import email_service, maintenance_service, sms_service
from tests.conftest import AsyncSessionLocal, auth_header, make_user


# --- a verified-but-pending account gets a limited session ------------------

async def test_login_succeeds_before_approval_but_stays_limited(client, db_session):
    user = await make_user(db_session, is_active=False)
    user.is_verified = True
    user.hashed_password = hash_password("supersecret123")
    await db_session.commit()

    resp = await client.post(
        "/auth/login", data={"username": user.email, "password": "supersecret123"},
    )
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # The one route a limited session needs: it can watch its own approval.
    me = await client.get("/users/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["is_active"] is False

    # Everything else stays behind get_current_user's is_active check.
    gated = await client.get("/users", headers=headers)
    assert gated.status_code == 403


async def test_refresh_keeps_working_for_a_pending_account(client, db_session):
    user = await make_user(db_session, is_active=False)
    user.is_verified = True
    await db_session.commit()

    resp = await client.post("/auth/refresh", json={"refresh_token": create_refresh_token(user.id)})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


async def test_refresh_rejects_an_unverified_account(client, db_session):
    user = await make_user(db_session, is_active=False)
    user.is_verified = False
    await db_session.commit()

    resp = await client.post("/auth/refresh", json={"refresh_token": create_refresh_token(user.id)})
    assert resp.status_code == 401


# --- editable profile --------------------------------------------------------

async def test_update_me_changes_only_what_is_sent(client, db_session):
    user = await make_user(db_session, is_active=True)
    user.phone = "9990001111"
    user.bar_council_id = "OLD-ID"
    await db_session.commit()

    resp = await client.patch(
        "/users/me", headers=auth_header(user), json={"bar_council_id": "NEW-ID"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["bar_council_id"] == "NEW-ID"
    assert body["phone"] == "9990001111"  # untouched


async def test_update_me_requires_a_session(client, db_session):
    resp = await client.patch("/users/me", json={"bar_council_id": "X"})
    assert resp.status_code == 401


async def test_update_me_does_not_accept_a_phone_directly(client, db_session):
    user = await make_user(db_session, is_active=True)
    resp = await client.patch(
        "/users/me", headers=auth_header(user), json={"phone": "9990001111"},
    )
    # Pydantic drops the unknown field rather than rejecting the request —
    # what matters is that it never reaches the user row.
    assert resp.status_code == 200
    assert resp.json()["phone"] is None


# --- a phone number is stored only once its OTP is verified ------------------

@pytest.fixture
def sms_outbox(monkeypatch):
    sent: list[dict] = []

    async def fake_send(to_phone, code):
        sent.append({"phone": to_phone, "code": code})

    monkeypatch.setattr(sms_service, "is_configured", lambda: True)
    monkeypatch.setattr(sms_service, "send_otp_sms", fake_send)
    return sent


async def test_requesting_a_phone_otp_texts_a_code_and_does_not_store_the_number(
    client, db_session, sms_outbox,
):
    user = await make_user(db_session, is_active=True)
    resp = await client.post(
        "/users/me/phone/otp", headers=auth_header(user), json={"phone": "9990001111"},
    )
    assert resp.status_code == 204
    assert len(sms_outbox) == 1
    assert sms_outbox[0]["phone"] == "9990001111"
    assert len(sms_outbox[0]["code"]) == 6

    me = await client.get("/users/me", headers=auth_header(user))
    assert me.json()["phone"] is None


async def test_normalizes_a_phone_number_with_a_country_code_and_spaces(
    client, db_session, sms_outbox,
):
    user = await make_user(db_session, is_active=True)
    resp = await client.post(
        "/users/me/phone/otp", headers=auth_header(user), json={"phone": "+91 99900 01111"},
    )
    assert resp.status_code == 204
    assert sms_outbox[0]["phone"] == "9990001111"


async def test_rejects_a_number_that_is_not_a_valid_indian_mobile(client, db_session, sms_outbox):
    user = await make_user(db_session, is_active=True)
    resp = await client.post(
        "/users/me/phone/otp", headers=auth_header(user), json={"phone": "12345"},
    )
    assert resp.status_code == 422
    assert sms_outbox == []


async def test_verifying_the_right_code_stores_the_number(client, db_session, sms_outbox):
    user = await make_user(db_session, is_active=True)
    await client.post(
        "/users/me/phone/otp", headers=auth_header(user), json={"phone": "9990001111"},
    )
    code = sms_outbox[0]["code"]

    resp = await client.post(
        "/users/me/phone/verify",
        headers=auth_header(user),
        json={"phone": "9990001111", "code": code},
    )
    assert resp.status_code == 200
    assert resp.json()["phone"] == "9990001111"

    me = await client.get("/users/me", headers=auth_header(user))
    assert me.json()["phone"] == "9990001111"


async def test_verifying_the_wrong_code_does_not_store_the_number(client, db_session, sms_outbox):
    user = await make_user(db_session, is_active=True)
    await client.post(
        "/users/me/phone/otp", headers=auth_header(user), json={"phone": "9990001111"},
    )

    resp = await client.post(
        "/users/me/phone/verify",
        headers=auth_header(user),
        json={"phone": "9990001111", "code": "000000"},
    )
    assert resp.status_code == 422

    me = await client.get("/users/me", headers=auth_header(user))
    assert me.json()["phone"] is None


async def test_a_code_sent_for_one_number_does_not_verify_a_different_one(
    client, db_session, sms_outbox,
):
    user = await make_user(db_session, is_active=True)
    await client.post(
        "/users/me/phone/otp", headers=auth_header(user), json={"phone": "9990001111"},
    )
    code = sms_outbox[0]["code"]

    resp = await client.post(
        "/users/me/phone/verify",
        headers=auth_header(user),
        json={"phone": "9990002222", "code": code},
    )
    assert resp.status_code == 422

    me = await client.get("/users/me", headers=auth_header(user))
    assert me.json()["phone"] is None


async def test_a_second_otp_request_invalidates_the_first_codes(client, db_session, sms_outbox):
    user = await make_user(db_session, is_active=True)
    await client.post(
        "/users/me/phone/otp", headers=auth_header(user), json={"phone": "9990001111"},
    )
    first_code = sms_outbox[0]["code"]
    await client.post(
        "/users/me/phone/otp", headers=auth_header(user), json={"phone": "9990001111"},
    )

    resp = await client.post(
        "/users/me/phone/verify",
        headers=auth_header(user),
        json={"phone": "9990001111", "code": first_code},
    )
    assert resp.status_code == 422


async def test_phone_otp_request_requires_a_session(client, db_session):
    resp = await client.post("/users/me/phone/otp", json={"phone": "9990001111"})
    assert resp.status_code == 401


# --- admin approval sends an email -------------------------------------------

@pytest.fixture
def outbox(monkeypatch):
    sent: list[dict] = []

    async def fake_send(to, subject, text, html):
        sent.append({"to": to, "subject": subject, "text": text, "html": html})

    monkeypatch.setattr(email_service, "is_configured", lambda: True)
    monkeypatch.setattr(email_service, "send_email", fake_send)
    return sent


async def test_approving_a_user_emails_them(client, db_session, outbox):
    admin = await make_user(db_session, role_name="super_admin")
    pending = await make_user(db_session, is_active=False, email="new-lawyer@example.com")
    pending.is_verified = True
    await db_session.commit()

    resp = await client.patch(f"/users/{pending.id}/approve", headers=auth_header(admin))
    assert resp.status_code == 200
    assert len(outbox) == 1
    assert outbox[0]["to"] == "new-lawyer@example.com"
    assert "approved" in outbox[0]["subject"].lower()


async def test_approving_a_user_does_not_fail_if_smtp_is_unconfigured(client, db_session, monkeypatch):
    monkeypatch.setattr(email_service, "is_configured", lambda: False)
    admin = await make_user(db_session, role_name="super_admin")
    pending = await make_user(db_session, is_active=False)
    pending.is_verified = True
    await db_session.commit()

    resp = await client.patch(f"/users/{pending.id}/approve", headers=auth_header(admin))
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True


# --- human-readable case numbers ---------------------------------------------

async def test_created_cases_get_a_unique_case_number(client, db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    resp = await client.post(
        "/cases", headers=auth_header(lawyer),
        json={"title": "Property dispute", "case_type": "civil"},
    )
    assert resp.status_code == 200
    number = resp.json()["case_number"]
    assert number is not None
    assert number.startswith(f"LF-{datetime.now(timezone.utc).year}-")

    second = await client.post(
        "/cases", headers=auth_header(lawyer),
        json={"title": "Another case", "case_type": "civil"},
    )
    assert second.json()["case_number"] != number


# --- the approval gate stays manual, but doesn't sit forgotten ---------------

async def sweep(hours_from_now):
    async with AsyncSessionLocal() as db:
        return await maintenance_service.remind_stale_pending_approvals(
            db, now=datetime.now(timezone.utc) + timedelta(hours=hours_from_now),
        )


async def test_reminds_admins_once_past_the_threshold_then_waits_out_the_gap(
    client, db_session, outbox,
):
    await make_user(db_session, role_name="super_admin", email="admin@example.com")
    pending = await make_user(db_session, is_active=False, email="waiting@example.com")
    pending.is_verified = True
    await db_session.commit()

    assert await sweep(24) == 0 and outbox == []  # too soon (default: 48h)
    assert await sweep(49) == 1
    assert outbox[0]["to"] == "admin@example.com"
    assert "waiting@example.com" in outbox[0]["text"]

    # Not renagged again inside the gap (default: 24h).
    outbox.clear()
    assert await sweep(60) == 0 and outbox == []
    # ...but does once the gap has passed.
    assert await sweep(74) == 1


async def test_no_reminder_without_a_user_manage_holder(client, db_session, outbox):
    # No admin seeded in this test's world at all.
    pending = await make_user(db_session, is_active=False, email="alone@example.com")
    pending.is_verified = True
    await db_session.commit()

    assert await sweep(72) == 0
    assert outbox == []


async def test_unverified_accounts_are_never_reminded_about(client, db_session, outbox):
    unverified = await make_user(db_session, is_active=False)
    unverified.is_verified = False
    await make_user(db_session, role_name="super_admin")
    await db_session.commit()

    assert await sweep(72) == 0
    assert outbox == []
