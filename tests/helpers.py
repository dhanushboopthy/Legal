"""Seed data straight into the database, so tests can start from any point in a
case's life without walking the whole flow through the API."""
import hashlib
import hmac
import json
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.case import Case
from app.models.document import CaseDocument, DocumentType
from app.models.payment import Payment, PaymentStatus, PaymentType
from app.models.quote import Quote, QuoteStatus
from app.models.user import User
from tests.conftest import make_pdf


async def seed_original(db: AsyncSession, case: Case, *, uploader: User, name: str = "petition.pdf") -> CaseDocument:
    doc = CaseDocument(
        case_id=case.id, type=DocumentType.ORIGINAL, version=1,
        storage_key=f"cases/{case.id}/{uuid.uuid4()}_{name}", original_filename=name,
        uploaded_by=uploader.id, size_bytes=1234, content_type="application/pdf",
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


async def seed_draft(
    db: AsyncSession, case: Case, *, uploader: User, version: int = 1, pages: int = 3,
) -> CaseDocument:
    doc = CaseDocument(
        case_id=case.id, type=DocumentType.DRAFT, version=version,
        storage_key=f"cases/{case.id}/{uuid.uuid4()}_draft_v{version}.pdf",
        original_filename=f"draft_v{version}.pdf", uploaded_by=uploader.id,
        size_bytes=len(make_pdf(pages)), content_type="application/pdf", page_count=pages,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


async def seed_quote(
    db: AsyncSession, case: Case, *, admin: User, status: QuoteStatus = QuoteStatus.OPEN,
    amount_paise: int = 250_000, version: int = 1,
) -> Quote:
    draft = await seed_draft(db, case, uploader=admin, version=version)
    quote = Quote(
        case_id=case.id, version=version, amount_paise=amount_paise, currency="INR",
        draft_document_id=draft.id, status=status, created_by=admin.id,
    )
    db.add(quote)
    await db.commit()
    await db.refresh(quote)
    return quote


async def seed_payment(
    db: AsyncSession, case: Case, *, type: PaymentType = PaymentType.REVIEW,
    status: PaymentStatus = PaymentStatus.PENDING, amount: float = 100, order_id: str = "order_abc",
    quote: Quote | None = None, payment_id: str | None = None,
) -> Payment:
    payment = Payment(
        case_id=case.id, type=type, amount=amount, currency="INR", status=status,
        gateway="razorpay", gateway_order_id=order_id, quote_id=quote.id if quote else None,
        gateway_payment_id=payment_id or ("pay_abc" if status != PaymentStatus.PENDING else None),
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    return payment


def signed_webhook(event: str, entity: dict, *, key: str = "payment") -> tuple[bytes, dict]:
    """A Razorpay webhook body and its signature header."""
    body = json.dumps({"event": event, "payload": {key: {"entity": entity}}}).encode()
    signature = hmac.new(settings.razorpay_webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    return body, {"X-Razorpay-Signature": signature, "Content-Type": "application/json"}
