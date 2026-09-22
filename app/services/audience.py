"""Who a case's events and messages concern. Kept apart from the services that
use it so realtime and chat can both ask without importing each other."""

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import CASE_MESSAGE, CASE_VIEW_ALL
from app.models.case import Case
from app.models.role import Role
from app.models.user import User


async def _holders(db: AsyncSession, *permissions: str) -> list[uuid.UUID]:
    result = await db.execute(
        select(User.id).join(Role, User.role_id == Role.id)
        .where(or_(*[Role.permissions.any(p) for p in permissions]), User.is_active.is_(True))
    )
    return list(result.scalars().all())


async def participants(db: AsyncSession, case: Case) -> list[uuid.UUID]:
    """The case's chat: its owner, and everyone holding case:message."""
    return list({case.junior_lawyer_id, *(await _holders(db, CASE_MESSAGE))})


async def viewers(db: AsyncSession, case: Case) -> list[uuid.UUID]:
    """Everyone who can see the case in a list: its owner and case:view_all
    holders. (A clerk sees the case but is not in its chat.)"""
    return list({case.junior_lawyer_id, *(await _holders(db, CASE_VIEW_ALL, CASE_MESSAGE))})
