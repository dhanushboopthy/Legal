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


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
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
    if not user.is_active:
        raise ForbiddenError("Account is not active yet — awaiting admin approval")

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
