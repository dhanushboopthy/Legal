import uuid

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.core.security import decode_token
from app.database import get_db
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

ACCESS_REMOVED = "Your access to this service has been removed. Please contact the office."



async def _user_from_token(token: str, db: AsyncSession) -> User:
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise UnauthorizedError("Invalid or expired token") from exc

    if payload.get("type") != "access":
        raise UnauthorizedError("Expected an access token")

    user_id = payload.get("sub")
    if user_id is None:
        raise UnauthorizedError("Token missing subject")

    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.id == uuid.UUID(user_id))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise UnauthorizedError("User no longer exists")
    return user


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await _user_from_token(token, db)
    if user.removed_at is not None:
        raise ForbiddenError(ACCESS_REMOVED)
    if not user.is_active:
        raise ForbiddenError("Account is not active yet — awaiting admin approval")
    return user


async def get_current_user_or_pending(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Like get_current_user, but admits a verified-but-not-yet-approved
    account too. Only for the one endpoint a limited session needs to work at
    all: GET /users/me, which the pending-approval screen polls. Every other
    route stays behind get_current_user / require_permission. A removed
    person is not "pending": they are refused here too."""
    user = await _user_from_token(token, db)
    if user.removed_at is not None:
        raise ForbiddenError(ACCESS_REMOVED)
    return user


def require_permission(permission: str):
    """
    Dependency factory: `Depends(require_permission(CASE_DECIDE))`.
    Checks the *current* permission list stored on the user's role row,
    so revoking a permission from a role takes effect immediately without
    requiring users to re-login.
    """

    async def _checker(current_user: User = Depends(get_current_user)) -> User:
        if permission not in (current_user.role.permissions or []):
            raise ForbiddenError(
                f"Your role '{current_user.role.name}' lacks the '{permission}' permission"
            )
        return current_user

    return _checker
