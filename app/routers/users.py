import uuid
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError
from app.core.logging import mask_email
from app.core.permissions import USER_MANAGE
from app.database import get_db
from app.dependencies import get_current_user, get_current_user_or_pending, require_permission
from app.models.role import Role
from app.models.user import User
from app.core.rate_limit import limiter
from app.schemas.user import AvatarConfirm, AvatarUploadRequest, AvatarUploadTarget, UserOut, UserUpdate
from app.services import audit_service, avatar_service, email_service, storage_service, token_service

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


@router.post("/me/avatar/upload-url", response_model=AvatarUploadTarget)
@limiter.limit("10/minute")
async def avatar_upload_url(
    request: Request,
    payload: AvatarUploadRequest,
    current_user: User = Depends(get_current_user),
):
    """A presigned PUT for a new profile picture (JPEG or PNG, up to 2 MB)."""
    key, url = avatar_service.upload_target(
        current_user, content_type=payload.content_type, size=payload.size,
    )
    return AvatarUploadTarget(key=key, url=url)


@router.put("/me/avatar", response_model=UserOut)
@limiter.limit("10/minute")
async def set_avatar(
    request: Request,
    payload: AvatarConfirm,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Use an uploaded picture, after checking it."""
    previous = await avatar_service.confirm(current_user, payload.key)
    await audit_service.log_action(
        db, user_id=current_user.id, action="user.avatar_changed",
        entity_type="user", entity_id=str(current_user.id),
    )
    await db.commit()
    if previous:
        await storage_service.delete_object(previous)
    await db.refresh(current_user, attribute_names=["role"])
    return UserOut.from_user(current_user)


@router.delete("/me/avatar", response_model=UserOut)
async def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    previous = avatar_service.remove(current_user)
    if previous:
        await audit_service.log_action(
            db, user_id=current_user.id, action="user.avatar_removed",
            entity_type="user", entity_id=str(current_user.id),
        )
    await db.commit()
    if previous:
        await storage_service.delete_object(previous)
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
    if user.removed_at is not None:
        raise ConflictError("This person was removed. Use Restore access to bring them back.")

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


# One key for every remove/restore, so two admins removing each other at the
# same moment can't both pass the "someone must still manage people" check.
_PEOPLE_LOCK = 0x7065_6f70  # "peop"


async def _load_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    await db.execute(select(func.pg_advisory_xact_lock(_PEOPLE_LOCK)))
    user = (await db.execute(
        select(User).options(selectinload(User.role)).where(User.id == user_id)
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found")
    return user


@router.patch("/{user_id}/remove", response_model=UserOut, dependencies=[Depends(require_permission(USER_MANAGE))])
async def remove_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Take someone off the service: they are signed out everywhere and can't
    sign in again until restored. Nothing is deleted: their cases, messages
    and payments stay, and Restore access brings them back as they were."""
    user = await _load_user(db, user_id)
    if user.id == current_user.id:
        raise ConflictError("You can't remove yourself.")
    if user.removed_at is not None:
        return UserOut.from_user(user)  # already removed: nothing to do

    if USER_MANAGE in (user.role.permissions or []):
        others = (await db.execute(
            select(func.count()).select_from(User).join(Role, User.role_id == Role.id).where(
                Role.permissions.any(USER_MANAGE), User.is_active.is_(True),
                User.removed_at.is_(None), User.id != user.id,
            )
        )).scalar_one()
        if others == 0:
            raise ConflictError("Someone else must be able to manage people before this person is removed.")

    user.removed_at = datetime.now(timezone.utc)
    user.is_active = False
    await token_service.revoke_all_for_user(db, user.id)
    await audit_service.log_action(
        db, user_id=current_user.id, action="user.removed", entity_type="user", entity_id=str(user.id),
    )
    await db.commit()
    await db.refresh(user)
    return UserOut.from_user(user)


@router.patch("/{user_id}/restore", response_model=UserOut, dependencies=[Depends(require_permission(USER_MANAGE))])
async def restore_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bring a removed person back. They sign in with their old password or
    Google account and find their cases where they left them."""
    user = await _load_user(db, user_id)
    if user.removed_at is None:
        raise ConflictError("This person hasn't been removed.")

    user.removed_at = None
    user.is_active = True
    await audit_service.log_action(
        db, user_id=current_user.id, action="user.restored", entity_type="user", entity_id=str(user.id),
    )
    await db.commit()
    await db.refresh(user)

    try:
        await email_service.send_email(
            user.email, "Your access has been restored",
            f"Hi {user.full_name}, your access has been restored. You can sign in again.",
            f"<p>Hi {user.full_name},</p><p>Your access has been restored. You can sign in again.</p>",
        )
    except Exception as exc:  # noqa: BLE001 - a flaky mail server shouldn't fail the restore
        logger.warning("restore_email_send_failed", email=mask_email(user.email), error=str(exc))

    return UserOut.from_user(user)
