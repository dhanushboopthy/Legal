# CLAUDE.md

Guidance for Claude (or any engineer) working in this repository.

## What this is

An RBAC-based case-filing platform for a law practice. Junior lawyers submit
cases for a senior advocate to review. After a review fee the advocate accepts,
discusses the case, then sends a draft together with a price; the junior pays
that price to unlock the download. `docs/NEW_FLOW_SPEC.md` is the source of
truth for the flow (`docs/workflow.md` predates it and is being replaced);
`docs/architecture.md` / `docs/low-level-design.md` describe the technical
design.

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
  worker.py          background loop (`python -m app.worker`): purges stale drafts
  core/
    security.py      password hashing, JWT issue/decode
    permissions.py    permission constants + ROLE_PERMISSIONS seed map
    uploads.py        accepted file types, magic bytes, filename rules
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
- **Every case-status transition goes through `case_service.TRANSITIONS`**
  (one table: from, to, who, permission) via `transition()`. Don't assign
  `case.status` anywhere else. Edges taken by a confirmed payment
  (`submitted -> review_fee_paid`, `quoted -> delivered`) are system-only: a
  person can never take them, whatever they hold. A new action that reaches
  one of those statuses must check its own source status too — "is the move
  legal for anyone" is not the same as "may this action make it".
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
  does not itself move the state machine. `POST /payments/{id}/reconcile`
  ("check status") feeds Razorpay's answer through the same handler.
- **Amounts come from the server.** A Razorpay order's amount is read from the
  quote row (or `REVIEW_FEE_INR`); whatever the client sends is ignored. The
  webhook re-checks order, amount and currency, and moves exactly one edge.
  Take the case row lock (`case_service.lock_case`) before deciding on a
  payment or replacing a quote, so the two can't interleave.
- **Download access is decided by the server.** A junior gets a draft's
  download link only when the case has a `paid` quote (a refund revokes it);
  otherwise `403 payment_required`. The document list marks such drafts
  `locked` and never includes a storage key.
- **Documents are not served through the API.** Downloads and uploads use
  presigned URLs (`storage_service.py`) that the browser calls directly. The
  api reads an object itself only to verify an upload (exists, size, first
  bytes, a draft's page count) — `storage_service.head_object/read_head/
  read_object` over `S3_INTERNAL_ENDPOINT_URL` — and never to serve it.
- **A draft case is its owner's private work.** A new case is `draft`;
  `authorize_case_access` and `visible_cases_query` hide it from everyone else
  (404, not 403), and the review fee can't be paid until `POST /cases/{id}/submit`.
  Files can be added or removed only in `draft`/`submitted`.
- **Upload rules are enforced by the server, twice.** `upload-urls` checks
  type (`app/core/uploads.py`), size and count, then signs the content type
  *and* size into the PUT (SeaweedFS answers 403 to any other); `confirm-batch`
  re-checks each object (belongs to the case, exists, limits, magic bytes),
  deletes what fails, and takes `lock_case` first so two confirmations can't
  both slip under the limit. Limits live in config, and the UI reads them from
  `GET /config/uploads` and `GET /config/pricing`.
- **Background work goes in the `worker` service**, not in request handlers:
  one asyncio loop, idempotent sweeps (`maintenance_service`), safe to run twice.
- **A case's chat (`message_service.py`) is participant-only**: its owner and
  anyone holding `case:message`, never everyone who can merely list the case
  (`case:view_all`). It exists only while the case is being worked on
  (`accepted` through `revision_requested`), stays read-only once `completed`,
  and doesn't exist before acceptance or after a rejection — check
  `is_participant`/`assert_open`/`assert_visible`, don't reimplement them.
  Sending is serialised per case (`pg_advisory_xact_lock` in `_lock_thread`)
  and idempotent on a browser-made `client_id`, so a retry can't duplicate or
  interleave with another sender's message. A status change writes its own
  line into the same chat, in the same transaction, via
  `message_service.post_event` — see the calls in `case_service.py`,
  `quote_service.py`, `payment_service.py` for the pattern; don't notify
  without also writing the line, or the other way round.
- **Realtime (`app/services/realtime.py`) is an accelerator, never a source of
  truth.** An event carries ids only ("case `X` has a new message"), never
  content; the browser then fetches through the normal, authorised endpoint.
  Events queue on the DB session and are only published `after_commit` (never
  `after_flush`), so a client can always fetch what it was just told about.
  Every screen still polls (3 s in an open thread, 30 s elsewhere) regardless
  of the socket, so a Redis outage degrades, it doesn't break anything.
  `WS /ws` authenticates with a single-use ticket from `POST /ws/ticket`
  (never a token in the URL); `ENVIRONMENT=test` swaps Redis pub/sub for an
  in-process stand-in (`MemoryBackend`) so tests need no Redis, and
  `realtime.enabled` is off in tests unless a test turns it on.

## Commands

```bash
# install
python -m venv venv && ./venv/bin/pip install -r requirements.txt -r requirements-dev.txt

# migrate + seed
./venv/bin/python -m alembic upgrade head
./venv/bin/python -m scripts.seed_roles

# run
./venv/bin/uvicorn app.main:app --reload
./venv/bin/python -m app.worker        # background sweeps (docker: the `worker` service)

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
includes a `db` service you can point tests at; with `docker-compose.override.yml`
it is on host port 5540, e.g.
`DATABASE_URL=postgresql+asyncpg://legal_user:legal_pass@localhost:5540/legal_filing_test pytest`.
Object storage is faked in tests (`fake_store` in `tests/conftest.py`).

## Migration note

`0004_quote_flow` retires five old case statuses and refuses to run over rows
that use them (no data mapping — the app wasn't live). On a dev database run
`python -m scripts.reset_dev_data --yes` first. After any migration that adds
permissions, re-run `python -m scripts.seed_roles` (role rows only change when
it runs).

`alembic/versions/0001_initial_schema.py` is hand-written, not autogenerated.
Postgres ENUM columns need `create_type=False` on the column-level type object
when the type was already created explicitly earlier in the same migration —
doing both raises `DuplicateObjectError`. If you add a new enum column, follow
the existing pattern in that file rather than autogenerating blind.

## Known gaps (see docs/backlog.md for the full list)

- No SLA/reminder job yet for cases sitting unreviewed.
- There is no e-signature step: the latest paid draft *is* the filing.
- The `clerk` and `accountant` roles are seeded with permissions but have no
  role-specific routes yet (they use the same endpoints as other roles that
  share a permission).
- The review/drafting fee split between a senior and junior advocate has an
  open compliance question under the Bar Council of India rules — flagged in
  docs/backlog.md, not resolved in code.

## UX work

- Before any UI change, read `.claude/skills/ux-principles` and `design-system`.
- The product flow is defined in `docs/NEW_FLOW_SPEC.md`. The plan is `docs/UX_REDESIGN_PLAN.md`. Do not skip phases.
- Gate UI by permissions from `/users/me`, never by `role_name`.
- Every screen designs loading, empty, error and success states.
- Money is always visible before any pay action. Amounts come from the server.
- Download access is enforced on the server, never only in the UI.
