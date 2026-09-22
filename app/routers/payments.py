import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.permissions import PAYMENT_REFUND, PAYMENT_VIEW_ALL
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.case import Case
from app.models.payment import Payment
from app.models.user import User
from app.schemas.payment import PaymentListItem, PaymentOut
from app.services import case_service, payment_service

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("/case/{case_id}", response_model=list[PaymentOut])
async def list_payments_for_case(
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)

    result = await db.execute(select(Payment).where(Payment.case_id == case_id))
    return list(result.scalars().all())


@router.get(
    "", response_model=list[PaymentListItem],
    dependencies=[Depends(require_permission(PAYMENT_VIEW_ALL))],
)
async def list_all_payments(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Payment)
        .options(selectinload(Payment.case).selectinload(Case.junior_lawyer))
        .order_by(Payment.created_at.desc())
    )
    return [
        PaymentListItem.model_validate(p).model_copy(update={
            "case_title": p.case.title, "junior_lawyer_name": p.case.junior_lawyer.full_name,
        })
        for p in result.scalars().all()
    ]


@router.post(
    "/{payment_id}/refund", response_model=PaymentOut,
    dependencies=[Depends(require_permission(PAYMENT_REFUND))],
)
async def refund_payment(
    payment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    payment = await payment_service.get_payment_or_404(db, payment_id)
    payment = await payment_service.refund_payment(db, payment=payment, admin=current_user)
    await db.commit()
    await db.refresh(payment)
    return payment


@router.post("/{payment_id}/reconcile", response_model=PaymentOut)
@limiter.limit("10/minute")
async def reconcile_payment(
    request: Request,
    payment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """"Check status": ask Razorpay what happened to this payment when the
    webhook hasn't arrived. Safe to call any time; a captured payment is
    processed exactly as the webhook would."""
    payment = await payment_service.get_payment_or_404(db, payment_id)
    case = await case_service.get_case_or_404(db, payment.case_id)
    case_service.authorize_case_access(case, current_user)
    payment = await payment_service.reconcile_payment(db, payment=payment)
    await db.commit()
    await db.refresh(payment)
    return payment
