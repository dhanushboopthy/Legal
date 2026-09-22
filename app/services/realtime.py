"""Push what just happened to browsers that are connected, so a message shows up
in a second instead of on the next poll.

Three parts:
  * an *outbox* on the DB session: services and routers queue events while they
    work; they are sent only after the transaction commits (a browser that
    hears "new message" must be able to fetch it), and dropped on rollback;
  * a *bus* that carries events between the api's worker processes: Redis
    pub/sub, or an in-process stand-in when ENVIRONMENT=test;
  * single-use *tickets* for opening a WebSocket without a token in the URL.

Events carry ids, never message text: the browser fetches what it is told
about through the normal, authorised endpoints.

Everything here is best-effort. Polling still works without it, so a Redis
outage or a failed publish is logged and never breaks a request."""

import asyncio
import json
import secrets
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import AsyncIterator

import structlog
from redis import asyncio as aioredis
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.config import settings
from app.models.case import Case, CaseStatus

logger = structlog.get_logger()

TICKET_TTL_SECONDS = 30


@dataclass(frozen=True)
class Event:
    type: str                 # message.created | case.status_changed | read.updated
    case_id: uuid.UUID
    audience: str             # "participants" (the chat) | "viewers" (anyone who lists the case)
    data: dict = field(default_factory=dict)


# --- transport ---------------------------------------------------------------

class MemoryBackend:
    """Same interface as RedisBackend, inside one process. For tests and for
    running the api without Redis."""

    def __init__(self) -> None:
        self._queues: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._tickets: dict[str, str] = {}

    async def publish(self, channel: str, payload: str) -> None:
        for queue in list(self._queues[channel]):
            queue.put_nowait(payload)

    async def subscribe(self, channel: str) -> AsyncIterator[str]:
        queue: asyncio.Queue = asyncio.Queue()
        self._queues[channel].add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self._queues[channel].discard(queue)

    async def set_ticket(self, token: str, user_id: str, ttl: int) -> None:
        self._tickets[token] = user_id  # expiry is not modelled in memory

    async def pop_ticket(self, token: str) -> str | None:
        return self._tickets.pop(token, None)


class RedisBackend:
    def __init__(self, url: str) -> None:
        self._redis = aioredis.from_url(url, decode_responses=True)

    async def publish(self, channel: str, payload: str) -> None:
        await self._redis.publish(channel, payload)

    async def subscribe(self, channel: str) -> AsyncIterator[str]:
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(channel)
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    yield message["data"]
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    async def set_ticket(self, token: str, user_id: str, ttl: int) -> None:
        await self._redis.set(f"ws-ticket:{token}", user_id, ex=ttl)

    async def pop_ticket(self, token: str) -> str | None:
        return await self._redis.getdel(f"ws-ticket:{token}")


_backend: MemoryBackend | RedisBackend | None = None


def get_backend() -> MemoryBackend | RedisBackend:
    global _backend
    if _backend is None:
        _backend = MemoryBackend() if settings.environment == "test" else RedisBackend(settings.redis_url)
    return _backend


def set_backend(backend: MemoryBackend | RedisBackend | None) -> None:
    global _backend
    _backend = backend


def user_channel(user_id: uuid.UUID | str) -> str:
    return f"user:{user_id}"


# --- tickets -----------------------------------------------------------------

async def issue_ticket(user_id: uuid.UUID) -> str:
    token = secrets.token_urlsafe(32)
    await get_backend().set_ticket(token, str(user_id), TICKET_TTL_SECONDS)
    return token


async def redeem_ticket(token: str) -> uuid.UUID | None:
    """Single use: a ticket that has been redeemed (or has expired) is gone."""
    try:
        raw = await get_backend().pop_ticket(token)
    except Exception as exc:
        logger.warning("ws_ticket_redeem_failed", error=str(exc))
        return None
    try:
        return uuid.UUID(raw) if raw else None
    except ValueError:
        return None


# --- outbox ------------------------------------------------------------------

# Off in tests unless a test turns it on: publishing opens its own database
# sessions, which must not outlive the test that caused them.
enabled = settings.environment != "test"
_tasks: set[asyncio.Task] = set()


def queue_event(db, ev: Event) -> None:
    """Send `ev` once the transaction `db` is in has committed."""
    sync = getattr(db, "sync_session", db)
    sync.info.setdefault("outbox", []).append(ev)


@event.listens_for(Session, "after_flush")
def _queue_status_changes(session: Session, _ctx) -> None:
    for obj in session.dirty:
        if isinstance(obj, Case) and inspect(obj).attrs.status.history.has_changes():
            session.info.setdefault("outbox", []).append(
                Event("case.status_changed", obj.id, "viewers", {"status": obj.status.value})
            )


@event.listens_for(Session, "after_commit")
def _publish_outbox(session: Session) -> None:
    events = session.info.pop("outbox", [])
    if not events or not enabled:
        return
    task = asyncio.get_running_loop().create_task(_deliver(events))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


@event.listens_for(Session, "after_rollback")
def _drop_outbox(session: Session) -> None:
    session.info.pop("outbox", None)


async def drain() -> None:
    """Wait for events already handed off to finish. For tests and shutdown."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def _deliver(events: list[Event]) -> None:
    from app.database import AsyncSessionLocal
    from app.services import audience

    # One status change per case per commit is enough, and the last one wins.
    status_changes: dict[uuid.UUID, Event] = {}
    to_send: list[Event] = []
    for ev in events:
        if ev.type == "case.status_changed":
            status_changes[ev.case_id] = ev
        else:
            to_send.append(ev)
    to_send.extend(status_changes.values())
    try:
        async with AsyncSessionLocal() as db:
            for ev in to_send:
                case = await db.get(Case, ev.case_id)
                if case is None:
                    continue
                if ev.audience == "participants":
                    recipients = await audience.participants(db, case)
                elif ev.data.get("status") in (CaseStatus.DRAFT.value, CaseStatus.SUBMITTED.value):
                    recipients = [case.junior_lawyer_id]  # the advocate sees a case once its fee is paid
                else:
                    recipients = await audience.viewers(db, case)
                payload = json.dumps({"type": ev.type, "case_id": str(ev.case_id), **ev.data})
                for user_id in recipients:
                    await get_backend().publish(user_channel(user_id), payload)
    except Exception as exc:
        logger.warning("realtime_publish_failed", error=str(exc))
