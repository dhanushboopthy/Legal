import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, ValidationAppError
from app.core.security import hash_password, verify_password
from app.models.phone_otp import PhoneOtp
from app.models.user import User

OTP_TTL_MINUTES = 10
MAX_ATTEMPTS = 5


def _generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


async def generate_and_store_otp(db: AsyncSession, *, user: User, phone: str) -> str:
    """Invalidates any outstanding phone OTP for this user (whatever number it
    was for) and issues a new one for `phone`. Returns the plaintext code —
    the only place it ever exists outside the hash is here and the SMS the
    caller sends with it. Nothing is written to `user.phone` yet."""
    await db.execute(delete(PhoneOtp).where(PhoneOtp.user_id == user.id))

    code = _generate_code()
    otp = PhoneOtp(
        user_id=user.id,
        phone=phone,
        code_hash=hash_password(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES),
    )
    db.add(otp)
    await db.flush()
    return code


async def verify_and_apply(db: AsyncSession, *, user: User, phone: str, code: str) -> None:
    """On a correct, current code for `phone`, writes it to `user.phone` —
    the number is never stored until it's verified."""
    result = await db.execute(
        select(PhoneOtp).where(PhoneOtp.user_id == user.id).order_by(PhoneOtp.created_at.desc())
    )
    otp = result.scalars().first()

    if otp is None:
        raise ValidationAppError("No verification code found — request a new one")
    if otp.phone != phone:
        raise ValidationAppError("That code was sent to a different number — request a new one")
    if otp.attempts >= MAX_ATTEMPTS:
        raise ConflictError("Too many incorrect attempts — request a new code")
    if datetime.now(timezone.utc) > otp.expires_at:
        raise ValidationAppError("This code has expired — request a new one")

    if not verify_password(code, otp.code_hash):
        otp.attempts += 1
        raise ValidationAppError("Incorrect code")

    user.phone = phone
    await db.delete(otp)
