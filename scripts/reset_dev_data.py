"""
Wipe case data from a DEVELOPMENT database, keeping users and roles:

    python -m scripts.reset_dev_data --yes

Removes cases and everything hanging off them (documents, payments, quotes,
revision requests, notifications, audit log). Needed once before migration
0004, which retires case statuses and refuses to run over rows that use them.
Files already uploaded to the object store are left behind.

Refuses to run when ENVIRONMENT=production, and does nothing without --yes.
"""
import asyncio
import sys

from sqlalchemy import text

from app.config import settings
from app.database import engine

# Children before parents; tables that don't exist yet (e.g. quotes before
# migration 0004) are skipped.
_TABLES = (
    "quotes", "payments", "case_documents", "revision_requests",
    "notifications", "audit_logs", "cases",
)


async def reset() -> None:
    async with engine.begin() as conn:
        present = [
            t for t in _TABLES
            if (await conn.execute(text("select to_regclass(:t)"), {"t": t})).scalar() is not None
        ]
        for table in present:
            count = (await conn.execute(text(f"select count(*) from {table}"))).scalar_one()
            print(f"{table}: {count} row(s)")
        await conn.execute(text(f"TRUNCATE TABLE {', '.join(present)} RESTART IDENTITY CASCADE"))
    print("cleared.")


def main() -> None:
    if settings.is_production:
        sys.exit("Refusing to reset data with ENVIRONMENT=production.")
    if "--yes" not in sys.argv:
        sys.exit("This deletes every case, payment and document row. Re-run with --yes to confirm.")
    asyncio.run(reset())


if __name__ == "__main__":
    main()
