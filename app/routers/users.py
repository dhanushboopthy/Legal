import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError
from app.core.permissions import USER_MANAGE
from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.user import UserOut

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def read_me(current_user: User = Depends(get_current_user)):
    return UserOut.from_user(current_user)


@router.get("/pending", response_model=list[UserOut], dependencies=[Depends(require_permission(USER_MANAGE))])
async def list_pending_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.is_active.is_(False))
    )
    users = result.scalars().all()
    return [UserOut.from_user(u) for u in users]


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
    return UserOut.from_user(user)
