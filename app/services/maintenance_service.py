"""Housekeeping the worker runs on a timer. Each sweep is idempotent and safe
to run from several processes at once."""

from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.case import Case, CaseStatus
from app.services import case_service

logger = structlog.get_logger()

_BATCH = 50


async def purge_stale_drafts(db: AsyncSession, *, now: datetime | None = None) -> int:
    """Delete draft cases nobody has touched for `draft_retention_days`, along
    with their files. Returns how many were removed.

    Each case is handled in its own transaction under a row lock that skips
    rows someone else holds: a case being submitted at this moment is left
    alone, and one failing to purge doesn't stop the rest."""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=settings.draft_retention_days)
    stale_ids = list((await db.execute(
        select(Case.id)
        .where(Case.status == CaseStatus.DRAFT, Case.updated_at < cutoff)
        .order_by(Case.updated_at).limit(_BATCH)
    )).scalars().all())
    await db.rollback()  # end the read transaction; each case gets its own

    purged = 0
    for case_id in stale_ids:
        try:
            case = (await db.execute(
                select(Case)
                .options(
                    selectinload(Case.documents), selectinload(Case.payments),
                    selectinload(Case.quotes),
                )
                .where(Case.id == case_id, Case.status == CaseStatus.DRAFT, Case.updated_at < cutoff)
                .with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            )).scalar_one_or_none()
            if case is None:  # submitted, touched, locked or already gone
                await db.rollback()
                continue
            await case_service.discard_draft(db, case=case, user=None)
            await db.commit()
            purged += 1
        except Exception as exc:
            await db.rollback()
            logger.error("draft_purge_failed", case_id=str(case_id), error=str(exc))
    return purged
