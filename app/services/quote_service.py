import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.core.money import format_inr
from app.models.case import Case, CaseStatus
from app.models.quote import Quote, QuoteStatus
from app.models.user import User
from app.services import audit_service, case_service, document_service, notification_service


def price_in_paise(amount_inr: int) -> int:
    lo, hi = settings.quote_min_inr, settings.quote_max_inr
    if not lo <= amount_inr <= hi:
        raise ValidationAppError(
            f"The price must be between {format_inr(lo * 100)} and {format_inr(hi * 100)}"
        )
    return amount_inr * 100


async def latest_quote(db: AsyncSession, case_id: uuid.UUID) -> Quote | None:
    result = await db.execute(
        select(Quote).where(Quote.case_id == case_id).order_by(Quote.version.desc()).limit(1)
    )
    return result.scalar_one_or_none()


async def get_quote_or_404(db: AsyncSession, case_id: uuid.UUID) -> Quote:
    quote = await latest_quote(db, case_id)
    if quote is None:
        raise NotFoundError("No draft has been quoted for this case yet")
    return quote


async def send_quote(
    db: AsyncSession, *, case: Case, admin: User, storage_key: str, filename: str,
    amount_inr: int, note: str | None,
) -> Quote:
    """Send (or replace) the draft and its price, atomically: verify the PDF,
    file it as the next draft version, supersede any unpaid quote, create the
    new one and move the case to `quoted`. No draft, no quote."""
    # Serialise with the payment webhook: a payment for the old quote landing
    # while we replace it must see the replaced state, not race past it.
    case = await case_service.lock_case(db, case.id)
    case_service.assert_can_transition(case, CaseStatus.QUOTED)
    amount_paise = price_in_paise(amount_inr)

    draft = await document_service.register_draft(
        db, case=case, uploader=admin, storage_key=storage_key, filename=filename,
    )

    previous = await db.execute(
        select(Quote).where(Quote.case_id == case.id, Quote.status == QuoteStatus.OPEN)
    )
    replaced = previous.scalar_one_or_none()
    if replaced is not None:
        replaced.status = QuoteStatus.SUPERSEDED
        await db.flush()

    next_version = (
        await db.execute(select(func.max(Quote.version)).where(Quote.case_id == case.id))
    ).scalar() or 0
    quote = Quote(
        case_id=case.id, version=next_version + 1, amount_paise=amount_paise, currency="INR",
        note=note, draft_document_id=draft.id, status=QuoteStatus.OPEN, created_by=admin.id,
    )
    db.add(quote)
    try:
        await db.flush()
    except IntegrityError:
        raise ConflictError("This case's quote was just changed. Reload and try again.") from None

    case_service.transition(case, CaseStatus.QUOTED, by=admin)

    price = format_inr(amount_paise)
    await audit_service.log_action(
        db, user_id=admin.id, action="quote.replaced" if replaced else "quote.sent",
        entity_type="quote", entity_id=str(quote.id),
        metadata={"case_id": str(case.id), "version": quote.version, "amount_paise": amount_paise},
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id, case_id=case.id, kind="quote_sent",
        message=(
            f"The price for '{case.title}' was updated to {price}. Pay to unlock your draft."
            if replaced else
            f"Your draft for '{case.title}' is ready. Pay {price} to unlock the download."
        ),
    )
    return quote
