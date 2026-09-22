import os
import subprocess
import sys
import uuid
from io import BytesIO
from types import SimpleNamespace

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
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import ROLE_PERMISSIONS
from app.core.security import create_access_token
from app.database import AsyncSessionLocal, engine
from app.main import app
from app.models.case import Case, CaseStatus
from app.models.role import Role
from app.models.user import User
from app.services import payment_service, storage_service

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_TABLES_TO_CLEAN = (
    "audit_logs", "notifications", "revision_requests", "quotes",
    "payments", "case_documents", "cases", "email_otps", "users",
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
            role = (await db.execute(select(Role).where(Role.name == name))).scalar_one_or_none()
            if role is None:
                db.add(Role(name=name, permissions=sorted(permissions)))
            else:
                # A reused test database may predate newly added permissions.
                role.permissions = sorted(permissions)
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
    # get_current_user loads the role with the user; do the same here.
    await db.refresh(user, ["role"])
    return user


def auth_header(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


async def make_case(
    db: AsyncSession, owner: User, *, status: CaseStatus = CaseStatus.SUBMITTED, title: str = "Test case",
) -> Case:
    case = Case(junior_lawyer_id=owner.id, title=title, case_type="civil", status=status)
    db.add(case)
    await db.flush()
    await db.commit()
    await db.refresh(case)
    return case


def make_pdf(pages: int = 2) -> bytes:
    """A real, readable PDF (the api counts its pages with pypdf)."""
    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


class FakeStore:
    """In-memory stand-in for the object store, patched over storage_service."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def put(self, key: str, data: bytes) -> str:
        self.objects[key] = data
        return key

    def put_pdf(self, case: Case, *, pages: int = 2, name: str = "draft.pdf") -> str:
        return self.put(f"cases/{case.id}/{uuid.uuid4()}_{name}", make_pdf(pages))


@pytest.fixture
def fake_store(monkeypatch) -> FakeStore:
    store = FakeStore()

    async def head_object(key):
        data = store.objects.get(key)
        return None if data is None else storage_service.ObjectInfo(size=len(data))

    async def read_object(key):
        return store.objects[key]

    async def read_head(key, length):
        return store.objects[key][:length]

    async def delete_object(key):
        store.objects.pop(key, None)
        store.deleted.append(key)

    async def delete_prefix(prefix):
        keys = [k for k in store.objects if k.startswith(prefix)]
        for key in keys:
            store.objects.pop(key)
            store.deleted.append(key)
        return len(keys)

    monkeypatch.setattr(storage_service, "head_object", head_object)
    monkeypatch.setattr(storage_service, "read_object", read_object)
    monkeypatch.setattr(storage_service, "read_head", read_head)
    monkeypatch.setattr(storage_service, "delete_object", delete_object)
    monkeypatch.setattr(storage_service, "delete_prefix", delete_prefix)
    monkeypatch.setattr(
        storage_service, "generate_presigned_download_url", lambda key: f"https://store.test/{key}?sig=x"
    )
    monkeypatch.setattr(
        storage_service, "generate_presigned_upload_url", lambda key, content_type="application/pdf", size=None: f"https://store.test/{key}?put=x&type={content_type}&size={size}"
    )
    return store


class FakeRazorpay:
    """Records what the api asks Razorpay to do; nothing leaves the process."""

    def __init__(self) -> None:
        self.orders: list[dict] = []
        self.refunds: list[str] = []
        self.order_payments: dict[str, list[dict]] = {}
        self.refund_error: Exception | None = None
        self.order = SimpleNamespace(create=self._create_order, payments=self._order_payments)
        self.payment = SimpleNamespace(refund=self._refund)

    def _create_order(self, data: dict) -> dict:
        order = {**data, "id": f"order_{len(self.orders) + 1}"}
        self.orders.append(order)
        return order

    def _order_payments(self, order_id: str) -> dict:
        return {"items": self.order_payments.get(order_id, [])}

    def _refund(self, payment_id: str, data: dict) -> dict:
        if self.refund_error is not None:
            raise self.refund_error
        self.refunds.append(payment_id)
        return {"id": f"rfnd_{len(self.refunds)}"}


@pytest.fixture
def fake_razorpay(monkeypatch) -> FakeRazorpay:
    fake = FakeRazorpay()
    monkeypatch.setattr(payment_service, "_razorpay_client", lambda: fake)
    return fake
