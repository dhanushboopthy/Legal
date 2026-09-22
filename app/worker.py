"""Background worker: `python -m app.worker`.

One asyncio loop that runs each sweep every `worker_interval_seconds`. There is
no queue and no scheduler dependency; every sweep is idempotent, so running two
workers, or restarting one mid-sweep, is harmless."""

import asyncio
import signal

import structlog

from app.config import settings
from app.database import AsyncSessionLocal
from app.services import maintenance_service

logger = structlog.get_logger()


async def run_once() -> None:
    async with AsyncSessionLocal() as db:
        purged = await maintenance_service.purge_stale_drafts(db)
    if purged:
        logger.info("stale_drafts_purged", count=purged)
    async with AsyncSessionLocal() as db:
        emailed = await maintenance_service.email_unread_messages(db)
    if emailed:
        logger.info("chat_emails_sent", count=emailed)


async def main() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    logger.info("worker_started", interval_seconds=settings.worker_interval_seconds)
    while not stop.is_set():
        try:
            await run_once()
        except Exception as exc:  # a failed sweep must not kill the loop
            logger.error("worker_sweep_failed", error=str(exc))
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.worker_interval_seconds)
        except asyncio.TimeoutError:
            pass
    logger.info("worker_stopped")


if __name__ == "__main__":
    asyncio.run(main())
