"""Housekeeping the worker runs on a timer. Each sweep is idempotent and safe
to run from several processes at once."""

import html
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.case import Case, CaseStatus
from app.models.message import CaseRead, Message, MessageKind
from app.models.user import User
from app.services import audience, case_service, email_service, message_service

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


# --- unread chat messages -> email -------------------------------------------

# Older than this and an unread message isn't worth an email any more.
_EMAIL_MAX_AGE = timedelta(days=7)
_warned_no_smtp = False


async def email_unread_messages(db: AsyncSession, *, now: datetime | None = None) -> int:
    """Email people who haven't opened a case chat that has messages for them.

    A person is emailed when the oldest message they haven't read is at least
    `chat_email_after_minutes` old, once per run of unread messages, and never
    more than once per `chat_email_min_gap_minutes` for the same case. The email
    says how many and links to the case; it never quotes the messages. Returns
    how many were sent."""
    global _warned_no_smtp
    if not email_service.is_configured():
        if not _warned_no_smtp:
            logger.warning("chat_email_skipped", reason="SMTP is not configured")
            _warned_no_smtp = True
        return 0

    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=settings.chat_email_after_minutes)
    oldest_allowed = now - _EMAIL_MAX_AGE
    written = (MessageKind.TEXT.value, MessageKind.FILE.value)

    case_ids = list((await db.execute(
        select(Message.case_id).where(
            Message.kind.in_(written), Message.created_at <= cutoff, Message.created_at >= oldest_allowed,
        ).distinct().limit(_BATCH * 4)
    )).scalars().all())
    await db.rollback()

    sent = 0
    for case_id in case_ids:
        try:
            sent += await _email_case_participants(
                db, case_id=case_id, now=now, cutoff=cutoff, oldest_allowed=oldest_allowed, written=written,
            )
        except Exception as exc:
            await db.rollback()
            logger.error("chat_email_failed", case_id=str(case_id), error=str(exc))
    return sent


async def _email_case_participants(
    db: AsyncSession, *, case_id, now: datetime, cutoff: datetime, oldest_allowed: datetime,
    written: tuple[str, ...],
) -> int:
    case = await db.get(Case, case_id)
    if case is None or case.status not in message_service.CHAT_VISIBLE:
        return 0
    sent = 0
    for user_id in await audience.participants(db, case):
        user = await db.get(User, user_id)
        read = (await db.execute(
            select(CaseRead).where(CaseRead.case_id == case_id, CaseRead.user_id == user_id)
        )).scalar_one_or_none()
        floor = max(read.last_read_message_id, read.last_emailed_message_id) if read else 0
        if read and read.last_emailed_at and read.last_emailed_at > now - timedelta(
            minutes=settings.chat_email_min_gap_minutes
        ):
            continue
        unread = (await db.execute(
            select(Message.id, Message.created_at).where(
                Message.case_id == case_id, Message.id > floor, Message.kind.in_(written),
                Message.sender_id != user_id, Message.created_at >= oldest_allowed,
            ).order_by(Message.id)
        )).all()
        if not unread or unread[0].created_at > cutoff or not user or not user.is_active:
            continue

        count = len(unread)
        link = f"{settings.app_base_url.rstrip('/')}/cases/{case.id}"
        noun = "message" if count == 1 else "messages"
        await email_service.send_email(
            user.email, "You have unread messages on a case",
            f"You have {count} unread {noun} on \"{case.title}\".\n\nOpen the case to read "
            f"{'it' if count == 1 else 'them'}: {link}\n\nThis email doesn't include the "
            f"{noun} themselves.",
            f"<p>You have <strong>{count}</strong> unread {noun} on <strong>{html.escape(case.title)}"
            f"</strong>.</p><p><a href=\"{html.escape(link)}\">Open the case</a> to read "
            f"{'it' if count == 1 else 'them'}.</p><p>This email doesn't include the {noun} themselves.</p>",
        )
        stmt = pg_insert(CaseRead).values(
            case_id=case_id, user_id=user_id, last_emailed_message_id=unread[-1].id, last_emailed_at=now,
        )
        await db.execute(stmt.on_conflict_do_update(
            index_elements=[CaseRead.case_id, CaseRead.user_id],
            set_={"last_emailed_message_id": unread[-1].id, "last_emailed_at": now},
        ))
        await db.commit()
        sent += 1
    await db.rollback()
    return sent
