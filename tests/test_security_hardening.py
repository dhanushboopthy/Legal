import pytest
from pydantic import ValidationError

from app.config import Settings


async def _login(client, ip: str):
    return await client.post(
        "/auth/login",
        data={"username": "nobody@example.com", "password": "wrong-password"},
        headers={"X-Real-IP": ip},
    )


async def test_login_is_rate_limited_per_client_address(client, db_session):
    codes = [(await _login(client, "203.0.113.7")).status_code for _ in range(11)]
    assert codes[:10] == [401] * 10
    assert codes[10] == 429
    # A different office is unaffected.
    assert (await _login(client, "203.0.113.8")).status_code == 401


async def test_register_is_rate_limited(client, db_session):
    codes = []
    for i in range(11):
        resp = await client.post(
            "/auth/register",
            json={"full_name": "Flood", "email": f"flood{i}@example.com", "password": "supersecret123"},
            headers={"X-Real-IP": "198.51.100.1"},
        )
        codes.append(resp.status_code)
    assert codes[-1] == 429 and 429 not in codes[:10]


async def test_api_responses_carry_security_headers(client, db_session):
    resp = await client.get("/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert "frame-ancestors 'none'" in resp.headers["Content-Security-Policy"]


async def test_auth_responses_are_never_cached(client, db_session):
    resp = await _login(client, "192.0.2.10")
    assert resp.headers["Cache-Control"] == "no-store"


_SAFE_PRODUCTION = dict(
    environment="production",
    debug=False,
    secret_key="x" * 64,
    database_url="postgresql+asyncpg://u:p@db/x",
    razorpay_webhook_secret="whsec",
    cors_origins="https://filing.example.com",
    s3_endpoint_url="https://files.example.com",
    app_base_url="https://filing.example.com",
)


def test_safe_production_settings_load():
    assert Settings(_env_file=None, **_SAFE_PRODUCTION).is_production


@pytest.mark.parametrize("override, message", [
    ({"secret_key": "short"}, "SECRET_KEY"),
    ({"secret_key": "change-this-to-a-random-64-char-secret"}, "SECRET_KEY"),
    ({"razorpay_webhook_secret": ""}, "RAZORPAY_WEBHOOK_SECRET"),
    ({"debug": True}, "DEBUG"),
    ({"cors_origins": "https://filing.example.com,http://localhost:5173"}, "CORS_ORIGINS"),
    ({"cors_origins": "*"}, "CORS_ORIGINS"),
    ({"s3_endpoint_url": "http://files.example.com"}, "S3_ENDPOINT_URL"),
    ({"app_base_url": "http://filing.example.com"}, "APP_BASE_URL"),
])
def test_unsafe_production_settings_refuse_to_load(override, message):
    with pytest.raises(ValidationError, match=message):
        Settings(_env_file=None, **{**_SAFE_PRODUCTION, **override})


def test_development_settings_are_not_checked():
    Settings(_env_file=None, **{**_SAFE_PRODUCTION, "environment": "development", "debug": True, "secret_key": "dev"})


async def test_support_contact_is_public(client, db_session, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "support_phone", "+91 22 5555 0100")
    resp = await client.get("/config/support")
    assert resp.status_code == 200
    assert resp.json() == {"email": None, "phone": "+91 22 5555 0100", "hours": None}
