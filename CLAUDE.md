# CLAUDE.md

Guidance for Claude (or any engineer) working in this repository.

## What this is

An RBAC-based case-filing platform for a law practice. Junior lawyers submit
cases for a senior advocate to review; on acceptance they pay a drafting fee
and receive a filed document back. See `docs/workflow.md` for the full
business flow and `docs/architecture.md` / `docs/low-level-design.md` for the
technical design.

The repo has two parts: the `app/` API (this file's main focus) and
`frontend/` (a Vite SPA + a small BFF) — see "Frontend" below.

## Stack

**Backend**: FastAPI (async) + SQLAlchemy 2.0 (async, asyncpg) + PostgreSQL +
Alembic + Razorpay (payments) + S3-compatible document storage (self-hosted
SeaweedFS in docker-compose; any S3 API works) + Redis (rate limiting) + JWT
auth.

**Frontend**: Vite + React 19 + TypeScript SPA (`frontend/web`) + a Node/
Express BFF (`frontend/bff`) that brokers login/refresh/logout so the
refresh token lives in an httpOnly cookie, never in browser JS. Tailwind CSS
+ Radix UI primitives, TanStack Query, react-hook-form + zod.

## Repo layout

```
app/
  main.py            FastAPI app, middleware, exception handlers, router wiring
  config.py          pydantic-settings, reads .env
  database.py        async engine/session, declarative Base
  dependencies.py    get_current_user, require_permission() — RBAC enforcement point
  core/
    security.py      password hashing, JWT issue/decode
    permissions.py    permission constants + ROLE_PERMISSIONS seed map
    exceptions.py     AppError hierarchy -> mapped to HTTP responses in main.py
  models/            SQLAlchemy ORM models (one file per table)
  schemas/           Pydantic request/response models
  services/          business logic + the case status state machine — routers
                     should stay thin and call into these, not embed logic
  routers/           HTTP endpoints, grouped by resource
alembic/             migrations — 0001 hand-written, see note below
scripts/seed_roles.py   idempotent role/permission seeding
tests/               pytest, requires a real Postgres (see Testing)
docs/                HLD, LLD, architecture, workflow, backlog
frontend/
  web/               Vite + React + TypeScript SPA — all UI
    src/lib/api/     typed API client functions, one file per backend router
    src/components/ui/  local component kit (Button, Card, Dialog, ...)
    src/features/    pages, grouped by domain (auth, cases, admin, ...)
  bff/               Node + Express BFF — only /login, /refresh, /logout;
                     everything else the SPA calls directly on the FastAPI
                     API (proxied same-origin, see nginx.conf / vite.config.ts)
```

## Conventions

- **Services own transitions, routers own I/O.** A router calls a service
  function, then does `await db.commit()` itself. Services `flush()` but do
  not `commit()` — this keeps a request's business logic and its audit log
  entry in one transaction.
- **Every case-status transition is guarded** in `app/services/case_service.py`
  via `_assert_status()` / `_REQUIRES_STATUS_FOR`. Don't mutate `case.status`
  directly from a router — add a new guarded function to the service instead.
- **RBAC is permission-based, not role-based**, at the check site:
  `Depends(require_permission(CASE_DECIDE))`, not `if user.role == "admin"`.
  Permissions live in `app/core/permissions.py`; role→permission defaults are
  seeded by `scripts/seed_roles.py` and can be edited per-deployment in the
  `roles` table without a code change.
- **Ownership checks are separate from permission checks.** A junior lawyer
  has `CASE_VIEW_OWN` but there's no per-row permission system — routers call
  `case_service.authorize_case_access(case, user)` explicitly wherever a
  specific case is loaded by ID.
- **Payments are webhook-driven, never client-confirmed.** A case only
  advances past a fee-gated status when `app/routers/webhooks.py` receives and
  verifies a signed Razorpay event — the client polling or reporting success
  does not itself move the state machine.
- **Documents never pass through the API server.** Upload/download use S3
  presigned URLs (`storage_service.py`); the server only ever handles the
  `storage_key`, never file bytes.

## Commands

```bash
# install
python -m venv venv && ./venv/bin/pip install -r requirements.txt -r requirements-dev.txt

# migrate + seed
./venv/bin/python -m alembic upgrade head
./venv/bin/python -m scripts.seed_roles

# run
./venv/bin/uvicorn app.main:app --reload

# test (see note below — needs a real Postgres, not sqlite)
./venv/bin/pytest

# docker — brings up db, redis, api, bff, web together
docker compose up --build
```

## Frontend

```bash
# terminal 1 — backend, as above (port 8000)

# terminal 2 — bff (port 4000)
cd frontend/bff && npm install && npm run dev

# terminal 3 — web (port 5173, dev-proxies /api -> :8000 and /bff -> :4000)
cd frontend/web && npm install && npm run dev

# checks, run from frontend/web or frontend/bff
npm run typecheck && npm run lint && npm run test && npm run build
```

Auth flow: the SPA never stores a token in localStorage. `POST /bff/login`
sets an httpOnly refresh-token cookie and returns a short-lived access token
that lives only in a React context; a 401 from the API triggers exactly one
`/bff/refresh` + retry (see `src/lib/api-client.ts`). In production, nginx
(`frontend/web/nginx.conf`) serves the built SPA and reverse-proxies
`/api/*` and `/bff/*` to the `api` and `bff` containers so everything is
same-origin — the backend's `CORS_ORIGINS` setting is a fallback for direct
API access, not something the deployed frontend relies on.

## Testing note

Models use Postgres-specific types (`UUID`, `ARRAY`, native `ENUM`), so tests
run against a real Postgres database, not sqlite — point `DATABASE_URL` in
`.env` at a disposable test database before running pytest. `docker-compose.yml`
includes a `db` service you can point tests at.

## Migration note

`alembic/versions/0001_initial_schema.py` is hand-written, not autogenerated.
Postgres ENUM columns need `create_type=False` on the column-level type object
when the type was already created explicitly earlier in the same migration —
doing both raises `DuplicateObjectError`. If you add a new enum column, follow
the existing pattern in that file rather than autogenerating blind.

## Known gaps (see docs/backlog.md for the full list)

- No SLA/reminder job yet for cases sitting unreviewed.
- "Draft" and "final signed filing" are the same document type/endpoint today
  — there's no separate e-signature step.
- The `clerk` and `accountant` roles are seeded with permissions but have no
  role-specific routes yet (they use the same endpoints as other roles that
  share a permission).
- The review/drafting fee split between a senior and junior advocate has an
  open compliance question under the Bar Council of India rules — flagged in
  docs/backlog.md, not resolved in code.
