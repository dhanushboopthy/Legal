from datetime import datetime, timedelta, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, UnauthorizedError, ValidationAppError
from app.core.google_auth import GoogleTokenError, GoogleUnavailableError, verify_google_id_token
from app.core.logging import mask_email
from app.core.rate_limit import client_ip, limiter
from app.core.security import hash_password, verify_password
from app.database import get_db
from app.dependencies import ACCESS_REMOVED
from app.models.role import Role
from app.models.user import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    GoogleLoginRequest,
    RefreshRequest,
    ResendOtpRequest,
    ResetPasswordRequest,
    Token,
    UserRegister,
    VerifyEmailRequest,
)
from app.schemas.user import UserOut
from app.services import audit_service, email_service, otp_service, token_service

router = APIRouter(prefix="/auth", tags=["auth"])
logger = structlog.get_logger()

MAX_FAILED_LOGINS = 5
LOCKOUT = timedelta(minutes=15)
# One message for an unknown email, a wrong password and a Google-only
# account, so sign-in can't be used to find out who has an account here.
BAD_CREDENTIALS = (
    "Email or password is incorrect. After 5 wrong tries, sign-in pauses for "
    "15 minutes. You can reset your password instead."
)
BAD_CODE = "This code is not valid. Check the email we sent, or ask for a new code."


async def _get_role(db: AsyncSession, name: str) -> Role:
    result = await db.execute(select(Role).where(Role.name == name))
    role = result.scalar_one_or_none()
    if role is None:
        raise ValidationAppError(f"'{name}' role is not seeded — run the DB seed script")
    return role


def _require_verified(user: User) -> None:
    """A verified email is enough to be issued a token — not admin approval.
    A verified-but-inactive user gets the same access/refresh token as anyone
    else; app.dependencies.get_current_user still 403s them everywhere except
    GET /users/me, which is what the pending-approval screen polls."""
    if not user.is_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Please verify your email first")


def _refuse_removed(user: User) -> None:
    """A person an admin removed gets no token by any route (password, Google,
    email code, password reset) until they are restored. Checked only once
    the credential is proven, so it says nothing to someone guessing."""
    if user.removed_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCESS_REMOVED)


def _token(pair: token_service.TokenPair) -> Token:
    return Token(access_token=pair.access_token, refresh_token=pair.refresh_token)


async def _audit(db: AsyncSession, user_id, action: str, **metadata) -> None:
    await audit_service.log_action(
        db, user_id=user_id, action=action, entity_type="user",
        entity_id=str(user_id) if user_id else "-", metadata=metadata or None,
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour", key_func=client_ip)
async def register(request: Request, payload: UserRegister, db: AsyncSession = Depends(get_db)):
    """
    Self-service registration for junior lawyers. Accounts are created
    unverified (until the email OTP is confirmed) and inactive (until an
    admin approves — see PATCH /users/{id}/approve). Both gates are
    required to log in.
    """
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none() is not None:
        raise ValidationAppError("An account with this email already exists. Sign in, or reset your password.")

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
    await db.flush()
    await _audit(db, user.id, "user.registered")
    await db.commit()
    await db.refresh(user, attribute_names=["role"])

    code = await otp_service.generate_and_store_otp(db, user=user)
    await db.commit()
    try:
        await email_service.send_otp_email(user.email, code)
    except Exception as exc:  # noqa: BLE001 - a flaky mail server shouldn't fail registration
        logger.warning("otp_email_send_failed", email=mask_email(user.email), error=str(exc))

    return UserOut.from_user(user)


@router.post("/verify-email", response_model=Token)
@limiter.limit("10/hour")
async def verify_email(request: Request, payload: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    """Verifying is enough to be issued a token (see _require_verified) — a
    freshly-verified junior lawyer lands on /pending-approval already signed
    in, with no separate login step, whether or not admin approval is next."""
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.email == payload.email)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise ValidationAppError(BAD_CODE)
    if user.is_verified:
        raise ValidationAppError("This account is already verified. Please sign in.")

    try:
        await otp_service.verify_otp(db, user=user, code=payload.code)
    except (ValidationAppError, ConflictError):
        # Even on a wrong/expired code, otp_service bumped attempts on the
        # row in memory — commit that either way, or a wrong guess would
        # never actually count towards the attempt limit.
        await db.commit()
        raise
    await _audit(db, user.id, "user.email_verified")
    _refuse_removed(user)
    pair = await token_service.issue_tokens(db, user.id)
    await db.commit()
    return _token(pair)


@router.post("/resend-otp", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/hour")
async def resend_otp(request: Request, payload: ResendOtpRequest, db: AsyncSession = Depends(get_db)):
    """Always 204, so it can't be used to test whether an email is registered."""
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if user is None or user.is_verified:
        return

    code = await otp_service.generate_and_store_otp(db, user=user)
    await db.commit()
    try:
        await email_service.send_otp_email(user.email, code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("otp_email_send_failed", email=mask_email(user.email), error=str(exc))


# Per address, loose enough for a law office sharing one IP; guessing one
# account's password is stopped by the per-account lockout below instead.
@router.post("/login", response_model=Token)
@limiter.limit("10/minute;60/hour", key_func=client_ip)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.email == form_data.username)
    )
    user = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if user is None or user.hashed_password is None:
        raise UnauthorizedError(BAD_CREDENTIALS)
    if user.locked_until is not None and user.locked_until > now:
        minutes = max(1, round((user.locked_until - now).total_seconds() / 60))
        raise UnauthorizedError(
            f"Sign-in is paused for {minutes} more minute{'s' if minutes != 1 else ''} after too many "
            "wrong passwords. You can reset your password instead."
        )
    if not verify_password(form_data.password, user.hashed_password):
        user.failed_login_count += 1
        locked = user.failed_login_count >= MAX_FAILED_LOGINS
        if locked:
            user.locked_until = now + LOCKOUT
            user.failed_login_count = 0
        await _audit(db, user.id, "user.login_locked" if locked else "user.login_failed", ip=client_ip(request))
        await db.commit()
        raise UnauthorizedError(BAD_CREDENTIALS)

    _require_verified(user)

    user.failed_login_count = 0
    user.locked_until = None
    await _audit(db, user.id, "user.login", method="password", ip=client_ip(request))
    _refuse_removed(user)
    pair = await token_service.issue_tokens(db, user.id)
    await db.commit()
    return _token(pair)


@router.post("/google", response_model=Token)
@limiter.limit("20/minute", key_func=client_ip)
async def google_login(request: Request, payload: GoogleLoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        claims = verify_google_id_token(payload.id_token)
    except GoogleTokenError as exc:
        raise UnauthorizedError(str(exc)) from exc
    except GoogleUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

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

    _require_verified(user)

    await _audit(db, user.id, "user.login", method="google", ip=client_ip(request))
    _refuse_removed(user)
    pair = await token_service.issue_tokens(db, user.id)
    await db.commit()
    return _token(pair)


@router.post("/refresh", response_model=Token)
@limiter.limit("60/minute", key_func=client_ip)
async def refresh(request: Request, payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        _, pair = await token_service.rotate(db, payload.refresh_token)
    except token_service.RefreshTokenReused:
        await db.commit()  # keep the family revocation
        raise
    await db.commit()
    return _token(pair)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Revokes the session the refresh token belongs to. Always 204."""
    user_id = await token_service.revoke_session(db, payload.refresh_token)
    if user_id is not None:
        await _audit(db, user_id, "user.logout")
    await db.commit()


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/hour", key_func=client_ip)
async def forgot_password(request: Request, payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Emails a reset code if the account exists. Always 204, so it can't be
    used to test whether an email is registered. Google-only accounts may use
    it too: setting a password just adds a second way to sign in."""
    user = (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none()
    if user is None:
        return

    code = await otp_service.generate_and_store_otp(db, user=user, purpose=otp_service.RESET_PASSWORD)
    await db.commit()
    try:
        await email_service.send_password_reset_email(user.email, code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("reset_email_send_failed", email=mask_email(user.email), error=str(exc))


@router.post("/reset-password", response_model=Token)
@limiter.limit("10/hour", key_func=client_ip)
async def reset_password(request: Request, payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Sets a new password with the emailed code, signs every other session
    out, clears any sign-in pause, and signs this browser in."""
    user = (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none()
    if user is None:
        raise ValidationAppError(BAD_CODE)

    try:
        await otp_service.verify_otp(db, user=user, code=payload.code, purpose=otp_service.RESET_PASSWORD)
    except (ValidationAppError, ConflictError):
        await db.commit()  # count the wrong attempt
        raise
    _refuse_removed(user)  # before anything changes: a removed person keeps their old password

    user.hashed_password = hash_password(payload.new_password)
    user.failed_login_count = 0
    user.locked_until = None
    await token_service.revoke_all_for_user(db, user.id)
    await _audit(db, user.id, "user.password_reset", ip=client_ip(request))
    pair = await token_service.issue_tokens(db, user.id)
    await db.commit()
    return _token(pair)
