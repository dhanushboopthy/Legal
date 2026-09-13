import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import PAYMENT_VIEW_ALL
from app.database import get_db
from app.dependencies import get_current_user
from app.models.payment import Payment
from app.models.user import User
from app.schemas.payment import PaymentOut
from app.services import case_service

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


@router.get("", response_model=list[PaymentOut])
async def list_all_payments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.core.exceptions import ForbiddenError

    if PAYMENT_VIEW_ALL not in (current_user.role.permissions or []):
        raise ForbiddenError("Only finance/admin roles may view all payments")

    result = await db.execute(select(Payment).order_by(Payment.created_at.desc()))
    return list(result.scalars().all())
