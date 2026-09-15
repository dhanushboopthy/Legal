import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, UnauthorizedError, ValidationAppError
from app.core.google_auth import GoogleTokenError, verify_google_id_token
from app.core.rate_limit import limiter
from app.core.security import create_access_token, create_refresh_token, decode_token, hash_password, verify_password
from app.database import get_db
from app.models.role import Role
from app.models.user import User
from app.schemas.auth import (
    GoogleLoginRequest,
    RefreshRequest,
    ResendOtpRequest,
    Token,
    UserRegister,
    VerifyEmailRequest,
)
from app.schemas.user import UserOut
from app.services import email_service, otp_service

router = APIRouter(prefix="/auth", tags=["auth"])
logger = structlog.get_logger()


async def _get_role(db: AsyncSession, name: str) -> Role:
    result = await db.execute(select(Role).where(Role.name == name))
    role = result.scalar_one_or_none()
    if role is None:
        raise ValidationAppError(f"'{name}' role is not seeded — run the DB seed script")
    return role


def _require_login_eligible(user: User) -> None:
    if not user.is_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Please verify your email first")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account pending admin approval")


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(payload: UserRegister, db: AsyncSession = Depends(get_db)):
    """
    Self-service registration for junior lawyers. Accounts are created
    unverified (until the email OTP is confirmed) and inactive (until an
    admin approves — see PATCH /users/{id}/approve). Both gates are
    required to log in.
    """
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none() is not None:
        raise ValidationAppError("An account with this email already exists")

    role = await _get_role(db, "junior_lawyer")

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

    code = await otp_service.generate_and_store_otp(db, user=user)
    await db.commit()
    try:
        await email_service.send_otp_email(user.email, code)
    except Exception as exc:  # noqa: BLE001 - a flaky mail server shouldn't fail registration
        logger.warning("otp_email_send_failed", email=user.email, error=str(exc))

    return UserOut.from_user(user)


@router.post("/verify-email", response_model=UserOut)
@limiter.limit("10/hour")
async def verify_email(request: Request, payload: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.email == payload.email)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise ValidationAppError("No account found for this email")
    if user.is_verified:
        raise ValidationAppError("This account is already verified")

    try:
        await otp_service.verify_otp(db, user=user, code=payload.code)
    except (ValidationAppError, ConflictError):
        # Even on a wrong/expired code, otp_service bumped attempts on the
        # row in memory — commit that either way, or a wrong guess would
        # never actually count towards the attempt limit.
        await db.commit()
        raise
    await db.commit()
    await db.refresh(user)
    return UserOut.from_user(user)


@router.post("/resend-otp", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/hour")
async def resend_otp(request: Request, payload: ResendOtpRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if user is None:
        raise ValidationAppError("No account found for this email")
    if user.is_verified:
        raise ValidationAppError("This account is already verified")

    code = await otp_service.generate_and_store_otp(db, user=user)
    await db.commit()
    try:
        await email_service.send_otp_email(user.email, code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("otp_email_send_failed", email=user.email, error=str(exc))


@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.email == form_data.username)
    )
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    if user.hashed_password is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This account signs in with Google")
    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

    _require_login_eligible(user)

    return Token(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/google", response_model=Token)
async def google_login(payload: GoogleLoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        claims = verify_google_id_token(payload.id_token)
    except GoogleTokenError as exc:
        raise UnauthorizedError(str(exc)) from exc

    google_sub = claims["sub"]
    email = claims["email"]

    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.google_sub == google_sub)
    )
    user = result.scalar_one_or_none()

    if user is None:
        result = await db.execute(
            select(User).options(selectinload(User.role)).where(User.email == email)
        )
        user = result.scalar_one_or_none()

        if user is None:
            role = await _get_role(db, "junior_lawyer")
            user = User(
                full_name=claims.get("name") or email,
                email=email,
                hashed_password=None,
                google_sub=google_sub,
                role_id=role.id,
                is_active=False,
                is_verified=True,
            )
            db.add(user)
        else:
            # An existing password account signing in with Google for the
            # first time for the same email — link it, Google's own
            # verification satisfies is_verified even if it wasn't already.
            user.google_sub = google_sub
            user.is_verified = True

        await db.commit()
        await db.refresh(user, attribute_names=["role"])

    _require_login_eligible(user)

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
