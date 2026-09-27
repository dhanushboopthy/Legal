"""Refresh-token rotation and revocation.

Every refresh token is a row (its `jti`). Signing in starts a family; each
refresh revokes the presented token and issues the next in the same family.
A revoked token presented again means someone else holds a copy, so the whole
family is revoked and both holders must sign in again — except within
REUSE_GRACE, where two tabs refreshing with the same cookie at the same
moment is the likely story, not theft.

Like every service here, this flushes but never commits.
"""
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import UnauthorizedError
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.models.refresh_token import RefreshToken
from app.models.user import User

REUSE_GRACE = timedelta(seconds=30)


class RefreshTokenReused(UnauthorizedError):
    """The family was revoked (and flushed); the caller must commit before
    letting this propagate, or the revocation is rolled back with the request."""


@dataclass
class TokenPair:
    access_token: str
    refresh_token: str


async def issue_tokens(db: AsyncSession, user_id: uuid.UUID, *, family_id: uuid.UUID | None = None) -> TokenPair:
    jti = uuid.uuid4()
    db.add(RefreshToken(
        jti=jti,
        user_id=user_id,
        family_id=family_id or uuid.uuid4(),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
    ))
    await db.flush()
    return TokenPair(create_access_token(user_id), create_refresh_token(user_id, jti=jti))


def _jti(refresh_token: str) -> uuid.UUID:
    try:
        data = decode_token(refresh_token)
    except ValueError as exc:
        raise UnauthorizedError("Invalid or expired refresh token") from exc
    if data.get("type") != "refresh" or "jti" not in data:
        raise UnauthorizedError("Expected a refresh token")
    try:
        return uuid.UUID(data["jti"])
    except ValueError as exc:
        raise UnauthorizedError("Invalid or expired refresh token") from exc


async def rotate(db: AsyncSession, refresh_token: str) -> tuple[User, TokenPair]:
    jti = _jti(refresh_token)
    row = (await db.execute(
        select(RefreshToken).where(RefreshToken.jti == jti).with_for_update()
    )).scalar_one_or_none()
    if row is None:
        raise UnauthorizedError("Invalid or expired refresh token")

    now = datetime.now(timezone.utc)
    if row.revoked_at is not None:
        if row.replaced_by is None:
            # Ended on purpose: sign-out, password reset, or a burned family.
            raise UnauthorizedError("This session has ended. Please sign in again.")
        if now - row.revoked_at > REUSE_GRACE or not await _is_live(db, row.replaced_by):
            await revoke_family(db, row.family_id)
            raise RefreshTokenReused("This session has ended. Please sign in again.")

    user = await db.get(User, row.user_id)
    if user is None or not user.is_verified:
        raise UnauthorizedError("User no longer eligible for a session")

    pair = await issue_tokens(db, user.id, family_id=row.family_id)
    if row.revoked_at is None:
        row.revoked_at = now
        row.replaced_by = _jti(pair.refresh_token)
    await db.flush()
    return user, pair


async def _is_live(db: AsyncSession, jti: uuid.UUID) -> bool:
    """The replacement is unrevoked, or was itself just rotated (not ended)."""
    successor = await db.get(RefreshToken, jti)
    return successor is not None and (successor.revoked_at is None or successor.replaced_by is not None)


async def revoke_family(db: AsyncSession, family_id: uuid.UUID) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    await db.flush()


async def revoke_session(db: AsyncSession, refresh_token: str) -> uuid.UUID | None:
    """Sign-out: revoke the presented token's family. An unusable token is
    already signed out, so that is not an error. Returns the user id, if any."""
    try:
        jti = _jti(refresh_token)
    except UnauthorizedError:
        return None
    row = await db.get(RefreshToken, jti)
    if row is None:
        return None
    await revoke_family(db, row.family_id)
    return row.user_id


async def revoke_all_for_user(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    await db.flush()
