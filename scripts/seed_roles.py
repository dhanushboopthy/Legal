"""
Idempotent role seeding script — run once per environment after migrations:

    python -m scripts.seed_roles

Safe to re-run: it upserts each role's permission list to match
app.core.permissions.ROLE_PERMISSIONS rather than erroring on conflict.
"""
import asyncio

from sqlalchemy import select

from app.core.permissions import ROLE_PERMISSIONS
from app.database import AsyncSessionLocal
from app.models.role import Role


async def seed_roles() -> None:
    async with AsyncSessionLocal() as db:
        for name, permissions in ROLE_PERMISSIONS.items():
            result = await db.execute(select(Role).where(Role.name == name))
            role = result.scalar_one_or_none()
            if role is None:
                db.add(Role(name=name, permissions=sorted(permissions)))
                print(f"created role: {name}")
            else:
                role.permissions = sorted(permissions)
                print(f"updated role: {name}")
        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed_roles())
