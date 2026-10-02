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
                     API (proxied same-origin, see nginx/default.conf.template / vite.config.ts)
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
  person can never take them through `transition()`, whatever they hold. The
  one exception is `payment_service.record_offline_payment` (below), which
  records the money first and then unlocks through the same `_quote_paid` the
  webhook uses. A new action that reaches
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
- **Drafting charges can also be paid offline.** Cash, GPay/UPI, bank
  transfer or cheque: someone with `payment:record_offline` calls
  `POST /cases/{id}/quote/record-payment` (method + optional reference, never
  an amount). It writes a `paid` Payment with `gateway='offline'` and the
  open quote's amount, under `lock_case`, then runs `_quote_paid`, so the
  chat line, notifications and download unlock are identical. A Razorpay
  capture for the same quote afterwards is auto-refunded. Refunding an offline
  payment applies at once (no gateway call) and locks the draft again. The
  review fee stays Razorpay-only.
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
- **Held over is a pause, not a decision.** An advocate with `case:hold` can
  move `accepted`/`revision_requested` to `held_over` (reason required,
  `cases.hold_reason`) and `POST /cases/{id}/resume` returns it to
  `cases.held_from`. Because `held_over -> accepted` and
  `held_over -> revision_requested` exist in `TRANSITIONS`, `decide_case` and
  `request_revision` check their own source status; do the same in any new
  action that reaches those statuses. UI words: "rejected" shows as
  **Deferred**, "request changes" as **Inform changes**, the quote amount as
  **Drafting charges**.
- **Profile pictures** (`avatar_service.py`, `users.avatar_key`): the browser
  crops to a 512px JPEG, PUTs it to a presigned URL under `avatars/{user_id}/`
  (type and size signed in), then `PUT /users/me/avatar` checks the key's
  owner, size and magic bytes before using it. They're shown via presigned GET
  URLs (1 hour) in `UserOut.avatar_url` and `CaseListItem.junior_lawyer_avatar_url`;
  the SPA reuses one URL per picture (`lib/avatar-url.ts`) so polling doesn't
  re-download it.
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
- **A verified email is enough for a token; admin approval is a separate,
  narrower gate.** `_require_verified` (not `_require_login_eligible`) is what
  `/auth/login`, `/auth/google` and `/auth/verify-email` check before issuing
  one — a verified-but-inactive account gets the same access/refresh token as
  anyone else. `get_current_user` still 403s that token everywhere except
  `GET /users/me` (`get_current_user_or_pending`), which is what the
  pending-approval screen polls. Don't loosen `get_current_user` itself to
  "fix" a pending-user 403 on some other route — add a route-specific lenient
  dependency instead, the way `/users/me` does.
- **The admin-approval gate is manual on purpose, but bounded.** It's never
  automated (a human always approves), but a verified account waiting past
  `pending_approval_reminder_after_hours` gets every `user:manage` holder one
  email (not one per pending account) via
  `maintenance_service.remind_stale_pending_approvals`, at most once per
  `pending_approval_reminder_gap_hours`.
- **Removing a person is not the same as "not yet approved".**
  `PATCH /users/{id}/remove` sets `users.removed_at` (and `is_active=False`)
  and revokes every refresh token; `/restore` clears it. Nothing is deleted.
  Every token-issuing route calls `auth._refuse_removed` once the credential
  is proven, and both `get_current_user` and `get_current_user_or_pending`
  refuse a removed user, so they never see the pending-approval screen. You
  can't remove yourself or the last active `user:manage` holder (checked
  under a `pg_advisory_xact_lock`). "Pending approval" everywhere (People
  page, reminders) means `is_active=False AND removed_at IS NULL`.
- **A case's `case_number` (`LF-2026-0042`) is assigned once, in
  `case_service.create_case`, from the `case_number_seq` Postgres sequence —
  never recomputed, never derived from `id`.** It's nullable at the DB level
  only so a test fixture that builds a `Case` directly doesn't need one; every
  case created through the API has one.
- **Refresh tokens are rows, not just JWTs** (`refresh_tokens`,
  `token_service.py`). Issue them only through `token_service.issue_tokens`;
  `/auth/refresh` rotates (revokes the old, issues the next in the same
  family), and presenting an already-rotated token revokes the whole family —
  except within `REUSE_GRACE` (30 s) of its rotation, so two tabs refreshing at
  once don't sign each other out. Sign-out (`/auth/logout`, called by the BFF)
  and a password reset revoke; a revoked token with no `replaced_by` is never
  honoured, grace or not.
- **Password sign-in locks for 15 minutes after 5 wrong passwords**
  (`users.failed_login_count`/`locked_until`). Unknown email, wrong password
  and Google-only account all return the same message; `resend-otp` and
  `forgot-password` always return 204. Don't reintroduce "no account found".
  New passwords (register, reset) go through `core/passwords.password_problem`;
  sign-in accepts any existing password. Hashing is `bcrypt` directly (no
  passlib), JWTs are PyJWT.
- **Rate limits key on the client address from `X-Real-IP`**
  (`rate_limit.client_ip`), which nginx sets and the BFF passes on. Auth
  routes use `key_func=client_ip`; everything else falls under
  `SlowAPIMiddleware`'s 300/min default. The api has no published port in
  `docker-compose.yml` for this reason: reachable only via nginx/BFF. Behind
  the Cloudflare Tunnel, nginx takes the visitor's address from
  `CF-Connecting-IP`, trusted only from `REAL_IP_FROM` (the prod compose
  network; `127.0.0.1/32`, i.e. off, in dev).
- **Production is one Windows PC** (`docs/production-windows.md`):
  `docker-compose.prod.yml` on top of the base file (never the override),
  project `legal-filing-prod`, settings in `.env.production` (git-ignored),
  nothing published on the host, the internet reaching `web` and `storage`
  only through the `cloudflared` service. `deploy/windows/start.ps1` builds,
  migrates, seeds roles and starts it; `backup.ps1`/`restore.ps1` cover the
  database and documents. The first advocate comes from
  `python -m scripts.create_admin`. Windows scripts target PowerShell 5.1.
- **`ENVIRONMENT=production` refuses to start with unsafe settings**
  (`Settings._refuse_unsafe_production`: short/placeholder `SECRET_KEY`, empty
  webhook secret, `DEBUG`, localhost CORS, non-https URLs). Add a rule there
  rather than a runtime check.
- **Security headers**: page-level ones (CSP, HSTS behind https, frame and
  referrer policy) live in `frontend/web/nginx/`; the CSP's storage origin is
  filled from `CSP_S3_ORIGIN` at container start. The api adds `nosniff`, a
  `default-src 'none'` CSP and `no-store` on `/auth/*` (`middleware.py`). A new
  third-party script or frame origin needs adding to the CSP.
- **`/` is two pages.** nginx serves `frontend/web/home.html` (the public,
  JS-free home page, the only indexable page) to visitors and the app's
  `index.html` to anyone with the `signed_in` cookie, which the BFF sets and
  clears alongside the `/bff`-scoped refresh cookie (it holds no secret).
  Everything except the home page, `robots.txt` and `sitemap.xml` gets
  `X-Robots-Tag: noindex` (the `$robots_tag` map). A new public page needs
  adding to that map and to `public/sitemap.xml`. What the home page says is
  limited by Bar Council of India Rule 36: facts only, no testimonials or
  solicitation.
- **Auth events are audited** (`user.login`, `user.login_failed`,
  `user.login_locked`, `user.logout`, `user.password_reset`,
  `user.email_verified`, `user.registered`, `user.approved`, `user.removed`,
  `user.restored`), in the same
  transaction as the action. Logs are JSON in production
  (`core/logging.configure_logging`); log emails through `mask_email`.

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
(`frontend/web/nginx/default.conf.template`) serves the built SPA and reverse-proxies
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
- **Look: calm and Apple-like, in light blue.** Inter (bundled), a light-blue page and sidebar, white cards with hairline borders and a soft shadow, one blue accent, navy (`navy`) for the brand and selected chips, gold (`gold`) as the warm complement; neutral fills are `bg-ink/[…]` tints, never `bg-black`. Pill buttons, grouped lists (`components/ui/list.tsx`), a sidebar on desktop. See `.claude/skills/design-system`. Third-party design skills (`ui-ux-pro-max`, `bencium-controlled-ux-designer`, `typography`, `design-audit`) are installed for guidance; the project's own skills win where they disagree (text sizes, target sizes).
- **Audience: older lawyers who may be new to technology.** Default ("Standard") text is Apple-website
  size: 14px body on desktop, 16px on phones; "Larger"/"Largest" in the Text size
  setting scale everything up (`index.css` root font-size, `lib/preferences.ts`),
  buttons at least 44px on phones (they scale with the text size on desktop),
  labels dark, not grey.
  Icon buttons show a text label wherever there is room; nothing important
  lives only in a hover tooltip; error toasts stay until dismissed; every
  inner page has a `BackLink` and a `usePageTitle`. The Text size setting
  (`lib/preferences.ts`) scales every rem, so size things in rem, never px.
