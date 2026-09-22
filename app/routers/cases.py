import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    CASE_APPROVE_FINAL,
    CASE_DECIDE,
    CASE_DRAFT,
    CASE_REQUEST_REVISION,
    CASE_SUBMIT,
    PAYMENT_INITIATE,
    QUOTE_CREATE,
)
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.case import Case
from app.models.revision import RevisionRequest
from app.models.user import User
from app.schemas.case import CaseCreate, CaseDecision, CaseListItem, CaseOut, CaseUpdate, RevisionCreate, RevisionOut
from app.schemas.document import DocumentOut
from app.schemas.payment import PaymentOrderResponse
from app.schemas.quote import DraftUpload, QuoteCreate, QuoteOut
from app.services import case_service, message_service, payment_service, quote_service

router = APIRouter(prefix="/cases", tags=["cases"])


@router.post("", response_model=CaseOut, dependencies=[Depends(require_permission(CASE_SUBMIT))])
async def create_case(
    payload: CaseCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.create_case(db, junior_lawyer=current_user, data=payload)
    await db.commit()
    await db.refresh(case)
    return case


@router.get("", response_model=list[CaseListItem])
async def list_cases(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(case_service.visible_cases_query(current_user).order_by(Case.created_at.desc()))
    cases = list(result.scalars().all())
    chat = await message_service.summaries(db, user=current_user, cases=cases)
    return [
        CaseListItem.model_validate(case).model_copy(update={
            "last_message": chat[case.id][0], "unread_count": chat[case.id][1],
            "turn": case_service.turn_for(case, current_user),
        })
        for case in cases
    ]


@router.get("/{case_id}", response_model=CaseOut)
async def get_case(
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)
    return case


@router.patch(
    "/{case_id}", response_model=CaseOut, dependencies=[Depends(require_permission(CASE_SUBMIT))],
)
async def update_case(
    case_id: uuid.UUID,
    payload: CaseUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Edit the details of a draft case (before it is submitted)."""
    case = await case_service.get_case_or_404(db, case_id)
    case_service.require_owner(case, current_user)
    case = await case_service.lock_case(db, case.id)
    case = await case_service.update_draft(db, case=case, data=payload)
    await db.commit()
    await db.refresh(case)
    return case


@router.delete(
    "/{case_id}", status_code=204, dependencies=[Depends(require_permission(CASE_SUBMIT))],
)
async def discard_case(
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Throw away a draft case and its uploaded files. A submitted case can't
    be deleted."""
    case = await case_service.get_case_or_404(db, case_id)
    case_service.require_owner(case, current_user)
    case = await case_service.lock_case(db, case.id)
    await case_service.discard_draft(db, case=case, user=current_user)
    await db.commit()
    return Response(status_code=204)


@router.post(
    "/{case_id}/submit", response_model=CaseOut, dependencies=[Depends(require_permission(CASE_SUBMIT))],
)
async def submit_case(
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a draft case for review. Needs at least one confirmed file; the
    lawyer pays the review fee next."""
    case = await case_service.get_case_or_404(db, case_id)
    case_service.require_owner(case, current_user)
    case = await case_service.lock_case(db, case.id)
    case = await case_service.submit_case(db, case=case, user=current_user)
    await db.commit()
    await db.refresh(case)
    return case


@router.post(
    "/{case_id}/review-payment", response_model=PaymentOrderResponse,
    dependencies=[Depends(require_permission(PAYMENT_INITIATE))],
)
@limiter.limit("10/minute")
async def create_review_payment(
    request: Request,
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)
    payment = await payment_service.create_review_order(db, case=case)
    await db.commit()
    return payment_service.order_response(payment)


@router.patch(
    "/{case_id}/decision", response_model=CaseOut, dependencies=[Depends(require_permission(CASE_DECIDE))],
)
async def decide_case(
    case_id: uuid.UUID,
    payload: CaseDecision,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, case_id)
    case = await case_service.decide_case(
        db, case=case, admin=current_user, accept=payload.accept,
        rejection_reason=payload.rejection_reason,
    )
    await db.commit()
    await db.refresh(case)
    return case


@router.post(
    "/{case_id}/quote", response_model=QuoteOut, status_code=201,
    dependencies=[Depends(require_permission(QUOTE_CREATE))],
)
async def send_quote(
    case_id: uuid.UUID,
    payload: QuoteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send the draft and its price together. Also how a draft or price is
    replaced while the quote is still unpaid."""
    case = await case_service.get_case_or_404(db, case_id)
    quote = await quote_service.send_quote(
        db, case=case, admin=current_user,
        storage_key=payload.draft.storage_key, filename=payload.draft.original_filename,
        amount_inr=payload.amount_inr, note=payload.note,
    )
    await db.commit()
    await db.refresh(quote)
    return quote


@router.get("/{case_id}/quote", response_model=QuoteOut)
async def get_quote(
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)
    return await quote_service.get_quote_or_404(db, case.id)


@router.post(
    "/{case_id}/quote/pay", response_model=PaymentOrderResponse,
    dependencies=[Depends(require_permission(PAYMENT_INITIATE))],
)
@limiter.limit("10/minute")
async def pay_quote(
    request: Request,
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start (or resume) payment of the open quote. The amount is read from the
    quote, never from the request; repeated calls return the same order."""
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)
    quote = await quote_service.get_quote_or_404(db, case.id)
    payment = await payment_service.create_quote_order(db, case=case, quote=quote)
    await db.commit()
    return payment_service.order_response(payment)


@router.post(
    "/{case_id}/drafts", response_model=DocumentOut, status_code=201,
    dependencies=[Depends(require_permission(CASE_DRAFT))],
)
async def upload_revised_draft(
    case_id: uuid.UUID,
    payload: DraftUpload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A new draft version after the junior asked for changes. Already paid
    for, so the case goes straight back to `delivered`."""
    case = await case_service.get_case_or_404(db, case_id)
    doc = await case_service.deliver_revised_draft(
        db, case=case, admin=current_user,
        storage_key=payload.storage_key, filename=payload.original_filename,
    )
    await db.commit()
    await db.refresh(doc)
    return DocumentOut.of(doc)


@router.post(
    "/{case_id}/revision", response_model=CaseOut,
    dependencies=[Depends(require_permission(CASE_REQUEST_REVISION))],
)
@limiter.limit("10/minute")
async def request_revision(
    request: Request,
    case_id: uuid.UUID,
    payload: RevisionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ask for changes. Free; the reason is required and shown to the advocate."""
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)
    case = await case_service.request_revision(
        db, case=case, junior_lawyer=current_user, reason=payload.reason,
    )
    await db.commit()
    await db.refresh(case)
    return case


@router.get("/{case_id}/revisions", response_model=list[RevisionOut])
async def list_revisions(
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """What changes were asked for. Until this existed the reason was stored but
    nothing could read it (F-04)."""
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)
    result = await db.execute(
        select(RevisionRequest).where(RevisionRequest.case_id == case.id)
        .order_by(RevisionRequest.created_at)
    )
    return list(result.scalars().all())


@router.post(
    "/{case_id}/approve", response_model=CaseOut, dependencies=[Depends(require_permission(CASE_APPROVE_FINAL))],
)
async def approve_case(
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)
    case = await case_service.approve_case(db, case=case, junior_lawyer=current_user)
    await db.commit()
    await db.refresh(case)
    return case
