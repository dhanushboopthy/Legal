from tests.conftest import auth_header, make_user


async def test_register_creates_inactive_junior_lawyer(client, db_session):
    resp = await client.post(
        "/auth/register",
        json={
            "full_name": "Junior Lawyer",
            "email": "junior@example.com",
            "password": "supersecret123",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["is_active"] is False
    assert body["role_name"] == "junior_lawyer"


async def test_register_rejects_duplicate_email(client, db_session):
    payload = {
        "full_name": "Dup",
        "email": "dup@example.com",
        "password": "supersecret123",
    }
    first = await client.post("/auth/register", json=payload)
    assert first.status_code == 201

    second = await client.post("/auth/register", json=payload)
    assert second.status_code == 422


async def test_login_blocked_until_approved(client, db_session):
    await client.post(
        "/auth/register",
        json={
            "full_name": "Pending",
            "email": "pending@example.com",
            "password": "supersecret123",
        },
    )

    resp = await client.post(
        "/auth/login",
        data={"username": "pending@example.com", "password": "supersecret123"},
    )
    assert resp.status_code == 403


async def test_protected_route_requires_token(client, db_session):
    resp = await client.get("/users/me")
    assert resp.status_code == 401


async def test_protected_route_accepts_valid_token(client, db_session):
    user = await make_user(db_session)
    resp = await client.get("/users/me", headers=auth_header(user))
    assert resp.status_code == 200
    assert resp.json()["id"] == str(user.id)


async def test_protected_route_rejects_garbage_token(client, db_session):
    resp = await client.get("/users/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401
