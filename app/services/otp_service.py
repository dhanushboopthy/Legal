import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, ValidationAppError
from app.core.security import hash_password, verify_password
from app.models.email_otp import EmailOtp
from app.models.user import User

OTP_TTL_MINUTES = 10
MAX_ATTEMPTS = 5


def _generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


async def generate_and_store_otp(db: AsyncSession, *, user: User) -> str:
    """Invalidates any outstanding OTP for this user and issues a new one.
    Returns the plaintext code — the only place it ever exists outside the
    hash is here and in the email the caller sends with it."""
    await db.execute(delete(EmailOtp).where(EmailOtp.user_id == user.id))

    code = _generate_code()
    otp = EmailOtp(
        user_id=user.id,
        code_hash=hash_password(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES),
    )
    db.add(otp)
    await db.flush()
    return code


async def verify_otp(db: AsyncSession, *, user: User, code: str) -> None:
    result = await db.execute(
        select(EmailOtp).where(EmailOtp.user_id == user.id).order_by(EmailOtp.created_at.desc())
    )
    otp = result.scalars().first()

    if otp is None:
        raise ValidationAppError("No verification code found — request a new one")
    if otp.attempts >= MAX_ATTEMPTS:
        raise ConflictError("Too many incorrect attempts — request a new code")
    if datetime.now(timezone.utc) > otp.expires_at:
        raise ValidationAppError("This code has expired — request a new one")

    if not verify_password(code, otp.code_hash):
        otp.attempts += 1
        raise ValidationAppError("Incorrect code")

    user.is_verified = True
    await db.delete(otp)
