from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
import jwt

from app.config import settings

# bcrypt only reads the first 72 bytes; schemas cap passwords there so two
# different long passwords can never hash alike.
BCRYPT_MAX_BYTES = 72


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())
    except ValueError:
        # Not a bcrypt hash, or an over-long password: never a match.
        return False


def _create_token(subject: UUID, expires_delta: timedelta, token_type: str, **claims) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(subject),
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
        **claims,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_access_token(user_id: UUID) -> str:
    return _create_token(
        user_id,
        timedelta(minutes=settings.access_token_expire_minutes),
        "access",
    )


def create_refresh_token(user_id: UUID, *, jti: UUID) -> str:
    """Use app.services.token_service.issue_tokens, which records the jti so
    the token can be revoked; a refresh token with no row is refused."""
    return _create_token(
        user_id,
        timedelta(days=settings.refresh_token_expire_days),
        "refresh",
        jti=str(jti),
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except jwt.PyJWTError as exc:
        raise ValueError("Invalid or expired token") from exc
