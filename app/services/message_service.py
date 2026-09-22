"""A case's chat (docs/NEW_FLOW_SPEC.md §7).

Two kinds of writer. People send text and files (`send`). Services record what
happened to the case as system messages and cards (`post_event`), inside the
same transaction as the event, so the thread can never disagree with the case.
"""

import uuid

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, ForbiddenError, ValidationAppError
from app.core.permissions import CASE_MESSAGE
from app.models.case import Case, CaseStatus
from app.models.document import CaseDocument
from app.models.message import CaseRead, Message, MessageAttachment, MessageKind
from app.models.notification import Notification
from app.models.user import User
from app.schemas.message import AttachmentOut, LastMessageOut, MessageOut
from app.schemas.upload import ConfirmFileSpec
from app.services import audience, document_service
from app.services.realtime import Event, queue_event

# D4: the chat is open while the case is being worked on, read-only once it is
# complete, and doesn't exist before the advocate accepts (or after a rejection).
CHAT_OPEN = {
    CaseStatus.ACCEPTED, CaseStatus.QUOTED, CaseStatus.DELIVERED, CaseStatus.REVISION_REQUESTED,
}
CHAT_VISIBLE = CHAT_OPEN | {CaseStatus.COMPLETED}

CHAT_NOTIFICATION = "chat_message"


# --- who and when ----------------------------------------------------------------

def is_participant(case: Case, user: User) -> bool:
    """The owner and anyone holding case:message. Deliberately not everyone who
    may *view* the case: a clerk can see that a case exists, not what is said."""
    return case.junior_lawyer_id == user.id or CASE_MESSAGE in (user.role.permissions or [])


def require_participant(case: Case, user: User) -> None:
    if not is_participant(case, user):
        raise ForbiddenError("Only the people on this case can use its chat")


def assert_visible(case: Case) -> None:
    if case.status == CaseStatus.REJECTED:
        raise ConflictError("This case wasn't accepted, so it has no chat")
    if case.status not in CHAT_VISIBLE:
        raise ConflictError("The chat opens once the advocate accepts the case")


def assert_open(case: Case) -> None:
    assert_visible(case)
    if case.status not in CHAT_OPEN:
        raise ConflictError("This case is complete, so its chat is read-only")


async def _lock_thread(db: AsyncSession, case_id: uuid.UUID) -> None:
    """One writer at a time per case until commit. That makes ids within a case
    appear in order, which is what lets a client ask for "everything after N"
    without ever skipping a message that committed late."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"chat:{case_id}"}
    )


def _clean(body: str | None) -> str | None:
    # NUL can't be stored in a Postgres text column.
    cleaned = (body or "").replace("\x00", "").strip()
    return cleaned or None


# --- read cursors ----------------------------------------------------------------

async def _advance_cursor(db: AsyncSession, case_id: uuid.UUID, user_id: uuid.UUID, message_id: int) -> None:
    """Move a user's read position forward, never back."""
    stmt = pg_insert(CaseRead).values(case_id=case_id, user_id=user_id, last_read_message_id=message_id)
    await db.execute(stmt.on_conflict_do_update(
        index_elements=[CaseRead.case_id, CaseRead.user_id],
        set_={
            "last_read_message_id": func.greatest(CaseRead.last_read_message_id, message_id),
            "updated_at": func.now(),
        },
    ))


async def _cursor(db: AsyncSession, case_id: uuid.UUID, user_id: uuid.UUID) -> int:
    value = await db.execute(
        select(CaseRead.last_read_message_id).where(CaseRead.case_id == case_id, CaseRead.user_id == user_id)
    )
    return value.scalar_one_or_none() or 0


async def unread_count(db: AsyncSession, case_id: uuid.UUID, user_id: uuid.UUID) -> int:
    return (await db.execute(
        select(func.count()).select_from(Message).where(
            Message.case_id == case_id,
            Message.id > await _cursor(db, case_id, user_id),
            or_(Message.sender_id.is_(None), Message.sender_id != user_id),
        )
    )).scalar_one()


async def mark_read(db: AsyncSession, *, case: Case, user: User, last_read_message_id: int) -> int:
    """Record that `user` has read the thread up to a message. The position can
    only move forward and can't pass the newest message in this case."""
    require_participant(case, user)
    assert_visible(case)
    newest = (await db.execute(
        select(func.coalesce(func.max(Message.id), 0)).where(Message.case_id == case.id)
    )).scalar_one()
    target = min(last_read_message_id, newest)
    await _advance_cursor(db, case.id, user.id, target)
    # Reading the thread is what clears its "new message" notification.
    await db.execute(
        Notification.__table__.update()
        .where(Notification.user_id == user.id, Notification.case_id == case.id,
               Notification.kind == CHAT_NOTIFICATION, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    queue_event(db, Event("read.updated", case.id, "participants", {
        "user_id": str(user.id), "last_read_message_id": target,
    }))
    return target


# --- writing ---------------------------------------------------------------------

async def post_event(
    db: AsyncSession, *, case: Case, kind: MessageKind, body: str | None = None,
    meta: dict | None = None, actor: User | None = None,
) -> Message:
    """Record an event on the case in its chat. No status check: the service
    that made the event decides it belongs there. The person who caused it (if
    a person did) has, by definition, already seen it."""
    await _lock_thread(db, case.id)
    message = Message(case_id=case.id, sender_id=None, kind=kind.value, body=body, meta=meta or {})
    db.add(message)
    await db.flush()
    if actor is not None:
        await _advance_cursor(db, case.id, actor.id, message.id)
    queue_event(db, Event("message.created", case.id, "participants", {"message_id": message.id}))
    return message


async def send(
    db: AsyncSession, *, case: Case, sender: User, body: str | None,
    attachments: list[ConfirmFileSpec], client_id: uuid.UUID,
) -> tuple[Message, bool]:
    """Post a person's message. Returns (message, created); sending the same
    `client_id` again returns the first message unchanged (created=False), so a
    retry after a lost response never posts twice."""
    require_participant(case, sender)
    assert_open(case)
    await _lock_thread(db, case.id)

    earlier = (await db.execute(
        select(Message).where(Message.sender_id == sender.id, Message.client_id == client_id)
    )).scalar_one_or_none()
    if earlier is not None:
        if earlier.case_id != case.id:
            raise ConflictError("That message id was already used elsewhere")
        return earlier, False

    text_body = _clean(body)
    if not text_body and not attachments:
        raise ValidationAppError("Write a message or attach a file")

    documents = (
        await document_service.register_attachments(db, case=case, uploader=sender, files=attachments)
        if attachments else []
    )
    message = Message(
        case_id=case.id, sender_id=sender.id, client_id=client_id, body=text_body,
        kind=(MessageKind.FILE if documents else MessageKind.TEXT).value,
    )
    db.add(message)
    await db.flush()
    for document in documents:
        db.add(MessageAttachment(message_id=message.id, document_id=document.id))
    await _advance_cursor(db, case.id, sender.id, message.id)
    await _notify_others(db, case=case, sender=sender, message=message)
    queue_event(db, Event("message.created", case.id, "participants", {"message_id": message.id}))
    await db.flush()
    return message, True


async def _notify_others(db: AsyncSession, *, case: Case, sender: User, message: Message) -> None:
    """One in-app notification per run of unread messages, not one per message:
    while a recipient hasn't looked, the same notification just counts up."""
    preview = preview_of(message, sender.full_name)
    for user_id in await audience.participants(db, case):
        if user_id == sender.id:
            continue
        count = await unread_count(db, case.id, user_id)
        text_ = (
            f"{sender.full_name} on '{case.title}': {preview}" if count <= 1
            else f"{count} new messages on '{case.title}'"
        )
        open_one = (await db.execute(
            select(Notification).where(
                Notification.user_id == user_id, Notification.case_id == case.id,
                Notification.kind == CHAT_NOTIFICATION, Notification.is_read.is_(False),
            ).limit(1)
        )).scalar_one_or_none()
        if open_one is None:
            db.add(Notification(user_id=user_id, case_id=case.id, kind=CHAT_NOTIFICATION, message=text_[:500]))
        else:
            open_one.message = text_[:500]
            open_one.created_at = func.now()  # rises to the top of the bell again


# --- reading ---------------------------------------------------------------------

def preview_of(message: Message, sender_name: str | None = None) -> str:
    if message.kind == MessageKind.FILE.value and not message.body:
        return "Sent a file"
    if message.kind == MessageKind.QUOTE.value:
        return message.body or "Draft and price sent"
    body = (message.body or "").replace("\n", " ")
    return body if len(body) <= 80 else body[:79] + "…"


async def serialize(db: AsyncSession, messages: list[Message]) -> list[MessageOut]:
    if not messages:
        return []
    ids = [m.id for m in messages]
    sender_ids = {m.sender_id for m in messages if m.sender_id}
    names = dict((await db.execute(
        select(User.id, User.full_name).where(User.id.in_(sender_ids))
    )).all()) if sender_ids else {}
    attachments: dict[int, list[AttachmentOut]] = {}
    rows = await db.execute(
        select(MessageAttachment.message_id, CaseDocument)
        .join(CaseDocument, CaseDocument.id == MessageAttachment.document_id)
        .where(MessageAttachment.message_id.in_(ids)).order_by(CaseDocument.created_at)
    )
    for message_id, document in rows.all():
        attachments.setdefault(message_id, []).append(AttachmentOut(
            document_id=document.id, filename=document.original_filename,
            size_bytes=document.size_bytes, content_type=document.content_type,
        ))
    return [
        MessageOut(
            id=m.id, case_id=m.case_id, sender_id=m.sender_id,
            sender_name=names.get(m.sender_id) if m.sender_id else None,
            kind=m.kind, body=m.body, meta=m.meta or {}, attachments=attachments.get(m.id, []),
            client_id=m.client_id, created_at=m.created_at,
        )
        for m in messages
    ]


async def list_page(
    db: AsyncSession, *, case: Case, viewer: User, before: int | None, after: int | None, limit: int,
) -> dict:
    """The newest `limit` messages, or the `limit` before a cursor, or (polling)
    everything after one. Oldest first."""
    require_participant(case, viewer)
    assert_visible(case)
    limit = max(1, min(limit, 100))
    base = select(Message).where(Message.case_id == case.id)

    has_more = False
    if after is not None:
        rows = (await db.execute(base.where(Message.id > after).order_by(Message.id).limit(limit))).scalars().all()
    else:
        query = base.where(Message.id < before) if before is not None else base
        newest_first = (await db.execute(query.order_by(Message.id.desc()).limit(limit + 1))).scalars().all()
        has_more = len(newest_first) > limit
        rows = list(reversed(newest_first[:limit]))

    others = (await db.execute(
        select(func.coalesce(func.max(CaseRead.last_read_message_id), 0))
        .where(CaseRead.case_id == case.id, CaseRead.user_id != viewer.id)
    )).scalar_one()
    return {
        "messages": await serialize(db, list(rows)),
        "has_more": has_more,
        "my_last_read_id": await _cursor(db, case.id, viewer.id),
        "other_last_read_id": others,
        "open": case.status in CHAT_OPEN,
    }


async def summaries(
    db: AsyncSession, *, user: User, cases: list[Case],
) -> dict[uuid.UUID, tuple[LastMessageOut | None, int]]:
    """Last message and unread count per case, for the cases list. Only cases the
    user is in the chat of; the rest get (None, 0)."""
    mine = [c.id for c in cases if is_participant(c, user) and c.status in CHAT_VISIBLE]
    result: dict[uuid.UUID, tuple[LastMessageOut | None, int]] = {c.id: (None, 0) for c in cases}
    if not mine:
        return result

    last_rows = (await db.execute(
        select(Message).where(Message.case_id.in_(mine))
        .distinct(Message.case_id).order_by(Message.case_id, Message.id.desc())
    )).scalars().all()
    names = dict((await db.execute(
        select(User.id, User.full_name).where(User.id.in_({m.sender_id for m in last_rows if m.sender_id}))
    )).all()) if last_rows else {}
    unread_rows = (await db.execute(
        select(Message.case_id, func.count())
        .outerjoin(CaseRead, and_(CaseRead.case_id == Message.case_id, CaseRead.user_id == user.id))
        .where(
            Message.case_id.in_(mine),
            Message.id > func.coalesce(CaseRead.last_read_message_id, 0),
            or_(Message.sender_id.is_(None), Message.sender_id != user.id),
        ).group_by(Message.case_id)
    )).all()
    unread = dict(unread_rows)
    for m in last_rows:
        sender = names.get(m.sender_id) if m.sender_id else None
        result[m.case_id] = (
            LastMessageOut(preview=preview_of(m, sender), at=m.created_at, sender_name=sender, kind=m.kind),
            unread.get(m.case_id, 0),
        )
    return result
