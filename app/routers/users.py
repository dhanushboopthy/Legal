import uuid

import structlog
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError
from app.core.logging import mask_email
from app.core.permissions import USER_MANAGE
from app.database import get_db
from app.dependencies import get_current_user, get_current_user_or_pending, require_permission
from app.models.user import User
from app.schemas.user import UserOut, UserUpdate
from app.services import audit_service, email_service

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


@router.get("", response_model=list[UserOut], dependencies=[Depends(require_permission(USER_MANAGE))])
async def list_users(db: AsyncSession = Depends(get_db)):
    """Everyone: the People page. Pending approvals are just the rows with
    is_active=False, not a separate list to reconcile against this one."""
    result = await db.execute(
        select(User).options(selectinload(User.role)).order_by(User.full_name)
    )
    return [UserOut.from_user(u) for u in result.scalars().all()]


@router.patch("/{user_id}/approve", response_model=UserOut, dependencies=[Depends(require_permission(USER_MANAGE))])
async def approve_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found")

    user.is_active = True
    user.is_verified = True
    await audit_service.log_action(
        db, user_id=current_user.id, action="user.approved", entity_type="user", entity_id=str(user.id),
    )
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
        logger.warning("approval_email_send_failed", email=mask_email(user.email), error=str(exc))

    return UserOut.from_user(user)
