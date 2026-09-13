import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification


async def notify(db: AsyncSession, *, user_id: uuid.UUID, message: str) -> None:
    db.add(Notification(user_id=user_id, message=message))


async def list_for_user(db: AsyncSession, *, user_id: uuid.UUID) -> list[Notification]:
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
    )
    return list(result.scalars().all())
