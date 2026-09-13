from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import UnauthorizedError, ValidationAppError
from app.core.security import create_access_token, create_refresh_token, decode_token, hash_password, verify_password
from app.database import get_db
from app.models.role import Role
from app.models.user import User
from app.schemas.auth import RefreshRequest, Token, UserRegister
from app.schemas.user import UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(payload: UserRegister, db: AsyncSession = Depends(get_db)):
    """
    Self-service registration for junior lawyers. Accounts are created
    inactive and must be approved by an admin before login works — see
    PATCH /users/{id}/approve.
    """
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none() is not None:
        raise ValidationAppError("An account with this email already exists")

    role_result = await db.execute(select(Role).where(Role.name == "junior_lawyer"))
    role = role_result.scalar_one_or_none()
    if role is None:
        raise ValidationAppError("junior_lawyer role is not seeded — run the DB seed script")

    user = User(
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        bar_council_id=payload.bar_council_id,
        hashed_password=hash_password(payload.password),
        role_id=role.id,
        is_active=False,
        is_verified=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user, attribute_names=["role"])
    return UserOut.from_user(user)


@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.email == form_data.username)
    )
    user = result.scalar_one_or_none()

    if user is None or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account pending admin approval")

    return Token(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=Token)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        data = decode_token(payload.refresh_token)
    except ValueError as exc:
        raise UnauthorizedError("Invalid or expired refresh token") from exc

    if data.get("type") != "refresh":
        raise UnauthorizedError("Expected a refresh token")

    user_id = data["sub"]
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise UnauthorizedError("User no longer active")

    return Token(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )
