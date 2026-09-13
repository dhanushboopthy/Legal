import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    CASE_APPROVE_FINAL,
    CASE_DECIDE,
    CASE_DRAFT,
    CASE_REQUEST_REVISION,
    CASE_SUBMIT,
    CASE_VIEW_ALL,
    PAYMENT_INITIATE,
)
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.case import Case
from app.models.user import User
from app.schemas.case import CaseCreate, CaseDecision, CaseOut, RevisionCreate
from app.schemas.payment import PaymentOrderResponse
from app.services import case_service, payment_service
from app.config import settings
from app.models.payment import PaymentType

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


@router.get("", response_model=list[CaseOut])
async def list_cases(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    query = select(Case)
    if CASE_VIEW_ALL not in (current_user.role.permissions or []):
        query = query.where(Case.junior_lawyer_id == current_user.id)
    result = await db.execute(query.order_by(Case.created_at.desc()))
    return list(result.scalars().all())


@router.get("/{case_id}", response_model=CaseOut)
async def get_case(
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)
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
    payment, order = await payment_service.create_order(db, case=case, payment_type=PaymentType.REVIEW)
    await db.commit()
    return PaymentOrderResponse(
        payment_id=payment.id, razorpay_order_id=order["id"],
        razorpay_key_id=settings.razorpay_key_id, amount_paise=order["amount"],
    )


@router.post(
    "/{case_id}/drafting-payment", response_model=PaymentOrderResponse,
    dependencies=[Depends(require_permission(PAYMENT_INITIATE))],
)
@limiter.limit("10/minute")
async def create_drafting_payment(
    request: Request,
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)
    payment, order = await payment_service.create_order(db, case=case, payment_type=PaymentType.DRAFTING)
    await db.commit()
    return PaymentOrderResponse(
        payment_id=payment.id, razorpay_order_id=order["id"],
        razorpay_key_id=settings.razorpay_key_id, amount_paise=order["amount"],
    )


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
    "/{case_id}/revision",
    dependencies=[
        Depends(require_permission(CASE_REQUEST_REVISION)),
        Depends(require_permission(PAYMENT_INITIATE)),
    ],
)
@limiter.limit("10/minute")
async def request_revision(
    request: Request,
    case_id: uuid.UUID,
    payload: RevisionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)

    case, requires_payment = await case_service.request_revision(
        db, case=case, junior_lawyer=current_user, reason=payload.reason,
        free_revisions=settings.free_revisions,
    )

    if requires_payment:
        payment, order = await payment_service.create_order(
            db, case=case, payment_type=PaymentType.REVISION,
        )
        await db.commit()
        return PaymentOrderResponse(
            payment_id=payment.id, razorpay_order_id=order["id"],
            razorpay_key_id=settings.razorpay_key_id, amount_paise=order["amount"],
        )

    await db.commit()
    await db.refresh(case)
    return CaseOut.model_validate(case)


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
