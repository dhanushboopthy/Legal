import asyncio
import json
from collections import Counter

import structlog
from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect

from app.core.rate_limit import limiter
from app.database import AsyncSessionLocal
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.message import TicketOut
from app.services import realtime

logger = structlog.get_logger()
router = APIRouter(tags=["realtime"])

PING_SECONDS = 25
MAX_SOCKETS_PER_USER = 5  # per api process; a few tabs, not a runaway client
_open: Counter = Counter()


@router.post("/ws/ticket", response_model=TicketOut)
@limiter.limit("30/minute")
async def issue_ticket(request: Request, current_user: User = Depends(get_current_user)):
    """A single-use ticket, good for 30 seconds, for opening the socket. A
    browser can't set an Authorization header on a WebSocket, and a token in the
    URL would end up in logs; this ticket is worthless once used."""
    return TicketOut(
        ticket=await realtime.issue_ticket(current_user.id),
        expires_in_seconds=realtime.TICKET_TTL_SECONDS,
    )


@router.websocket("/ws")
async def events(websocket: WebSocket, ticket: str = ""):
    """Server -> browser events (`message.created`, `case.status_changed`,
    `read.updated`), each carrying ids only; the browser fetches details through
    the normal endpoints. Nothing the browser sends is acted on."""
    await websocket.accept()
    user_id = await realtime.redeem_ticket(ticket)
    if user_id is None:
        await websocket.close(code=4401)  # bad, used or expired ticket
        return
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
    if user is None or not user.is_active:
        await websocket.close(code=4403)
        return
    if _open[user_id] >= MAX_SOCKETS_PER_USER:
        await websocket.close(code=4429)
        return

    _open[user_id] += 1
    events_iter = realtime.get_backend().subscribe(realtime.user_channel(user_id))

    async def forward() -> None:
        async for payload in events_iter:
            await websocket.send_text(payload)

    async def keepalive() -> None:
        while True:
            await asyncio.sleep(PING_SECONDS)
            await websocket.send_text(json.dumps({"type": "ping"}))

    async def watch_client() -> None:
        while True:  # returns (raises) when the browser goes away
            await websocket.receive_text()

    tasks = [asyncio.create_task(c()) for c in (forward, keepalive, watch_client)]
    try:
        await websocket.send_text(json.dumps({"type": "ready"}))
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("ws_error", error=str(exc))
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await events_iter.aclose()
        _open[user_id] -= 1
        if _open[user_id] <= 0:
            del _open[user_id]
