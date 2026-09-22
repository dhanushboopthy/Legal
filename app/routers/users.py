import uuid

import structlog
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.core.permissions import USER_MANAGE
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import get_current_user, get_current_user_or_pending, require_permission
from app.models.user import User
from app.schemas.user import PhoneOtpRequest, PhoneOtpVerify, UserOut, UserUpdate
from app.services import email_service, phone_otp_service, sms_service

router = APIRouter(prefix="/users", tags=["users"])
logger = structlog.get_logger()


@router.get("/me", response_model=UserOut)
async def read_me(current_user: User = Depends(get_current_user_or_pending)):
    """Works for a verified-but-not-yet-approved account too — this is what
    the pending-approval screen polls to notice its own approval."""
    return UserOut.from_user(current_user)


@router.patch("/me", response_model=UserOut)
async def update_me(payload: UserUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user, attribute_names=["role"])
    return UserOut.from_user(current_user)


@router.post("/me/phone/otp", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/hour")
async def request_phone_otp(
    request: Request,
    payload: PhoneOtpRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Texts a code to a candidate number — it isn't stored on the profile
    until POST /users/me/phone/verify confirms it (same pattern as the
    registration email OTP, see app/services/otp_service.py)."""
    code = await phone_otp_service.generate_and_store_otp(db, user=current_user, phone=payload.phone)
    await db.commit()
    try:
        await sms_service.send_otp_sms(payload.phone, code)
    except Exception as exc:  # noqa: BLE001 - a flaky SMS gateway shouldn't 500 the request
        logger.warning("phone_otp_sms_send_failed", phone=payload.phone, error=str(exc))


@router.post("/me/phone/verify", response_model=UserOut)
@limiter.limit("10/hour")
async def verify_phone_otp(
    request: Request,
    payload: PhoneOtpVerify,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await phone_otp_service.verify_and_apply(
            db, user=current_user, phone=payload.phone, code=payload.code
        )
    except (ValidationAppError, ConflictError):
        # A wrong/expired guess still bumped attempts on the row in memory —
        # commit that either way, or a wrong guess would never count.
        await db.commit()
        raise
    await db.commit()
    await db.refresh(current_user, attribute_names=["role"])
    return UserOut.from_user(current_user)


@router.get("", response_model=list[UserOut], dependencies=[Depends(require_permission(USER_MANAGE))])
async def list_users(db: AsyncSession = Depends(get_db)):
    """Everyone: the People page. Pending approvals are just the rows with
    is_active=False, not a separate list to reconcile against this one."""
    result = await db.execute(
        select(User).options(selectinload(User.role)).order_by(User.full_name)
    )
    return [UserOut.from_user(u) for u in result.scalars().all()]


@router.patch("/{user_id}/approve", response_model=UserOut, dependencies=[Depends(require_permission(USER_MANAGE))])
async def approve_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found")

    user.is_active = True
    user.is_verified = True
    await db.commit()
    await db.refresh(user)

    try:
        await email_service.send_email(
            user.email, "Your account has been approved",
            f"Hi {user.full_name}, your account has been approved. You can now sign in and submit cases.",
            f"<p>Hi {user.full_name},</p><p>Your account has been approved. "
            "You can now sign in and submit cases.</p>",
        )
    except Exception as exc:  # noqa: BLE001 - a flaky mail server shouldn't fail the approval
        logger.warning("approval_email_send_failed", email=user.email, error=str(exc))

    return UserOut.from_user(user)
