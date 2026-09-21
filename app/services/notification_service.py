import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.core.permissions import CASE_DECIDE
from app.models.notification import Notification
from app.models.role import Role
from app.models.user import User

_MAX_MESSAGE = 500  # notifications.message is String(500)


def _fit(message: str) -> str:
    return message if len(message) <= _MAX_MESSAGE else message[: _MAX_MESSAGE - 1] + "…"


async def notify(
    db: AsyncSession, *, user_id: uuid.UUID, message: str,
    case_id: uuid.UUID | None = None, kind: str | None = None,
) -> None:
    db.add(Notification(user_id=user_id, message=_fit(message), case_id=case_id, kind=kind))


async def notify_reviewers(
    db: AsyncSession, *, message: str,
    case_id: uuid.UUID | None = None, kind: str | None = None,
) -> None:
    """Tell everyone who decides cases (today: the advocate). The advocate used
    to get no notifications at all (F-03)."""
    result = await db.execute(
        select(User.id)
        .join(Role, User.role_id == Role.id)
        .where(Role.permissions.any(CASE_DECIDE), User.is_active.is_(True))
    )
    for user_id in result.scalars().all():
        await notify(db, user_id=user_id, message=message, case_id=case_id, kind=kind)


async def list_for_user(db: AsyncSession, *, user_id: uuid.UUID) -> list[Notification]:
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
    )
    return list(result.scalars().all())


async def mark_read(db: AsyncSession, *, user_id: uuid.UUID, notification_id: uuid.UUID) -> Notification:
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user_id,
        )
    )
    notification = result.scalar_one_or_none()
    if notification is None:
        raise NotFoundError("Notification not found")
    notification.is_read = True
    return notification
