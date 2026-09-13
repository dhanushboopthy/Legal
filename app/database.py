from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import settings

if settings.environment.lower() == "test":
    # Each pytest-asyncio test (and session-scoped fixture) may run under a
    # different event loop; a persistent pool would hand out asyncpg
    # connections opened on one loop to a checkout on another and blow up.
    # NullPool opens a fresh connection per checkout, sidestepping that.
    engine = create_async_engine(settings.database_url, echo=settings.debug, poolclass=NullPool)
else:
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
