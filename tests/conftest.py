import os
import subprocess
import sys
import uuid

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DEBUG", "true")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://legal_user:legal_pass@localhost:5432/legal_filing_test",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_dummy")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "dummy_secret")
os.environ.setdefault("RAZORPAY_WEBHOOK_SECRET", "dummy_webhook_secret")
os.environ.setdefault("S3_BUCKET_NAME", "test-bucket")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import ROLE_PERMISSIONS
from app.core.security import create_access_token
from app.database import AsyncSessionLocal, engine
from app.main import app
from app.models.role import Role
from app.models.user import User

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_TABLES_TO_CLEAN = (
    "audit_logs", "notifications", "revision_requests",
    "payments", "case_documents", "cases", "users",
)


@pytest.fixture(scope="session", autouse=True)
def _apply_migrations():
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=REPO_ROOT, check=True,
        env={**os.environ},
    )
    yield


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _seed_roles(_apply_migrations):
    async with AsyncSessionLocal() as db:
        for name, permissions in ROLE_PERMISSIONS.items():
            result = await db.execute(text("select 1 from roles where name = :name"), {"name": name})
            if result.first() is None:
                db.add(Role(name=name, permissions=sorted(permissions)))
        await db.commit()
    yield


@pytest_asyncio.fixture
async def db_session():
    async with AsyncSessionLocal() as session:
        yield session
    async with engine.begin() as conn:
        for table in _TABLES_TO_CLEAN:
            await conn.execute(text(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE"))


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def make_user(
    db: AsyncSession, *, role_name: str = "junior_lawyer", is_active: bool = True,
    email: str | None = None,
) -> User:
    result = await db.execute(text("select id from roles where name = :name"), {"name": role_name})
    role_id = result.scalar_one()

    user = User(
        full_name="Test User",
        email=email or f"{uuid.uuid4()}@example.com",
        hashed_password="not-used-in-tests",
        role_id=role_id,
        is_active=is_active,
        is_verified=is_active,
    )
    db.add(user)
    await db.flush()
    await db.commit()
    await db.refresh(user)
    return user


def auth_header(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}
