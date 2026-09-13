# Architecture

## 1. System context

```
                    ┌─────────────────────┐
                    │   Junior lawyer      │
                    │ (submits cases, pays │
                    │  fees, downloads     │
                    │  filings)            │
                    └──────────┬───────────┘
                               │ HTTPS / REST
                    ┌──────────▼───────────┐        ┌─────────────────┐
                    │                      │◄──────►│   Razorpay        │
                    │  Case Filing API     │        │ (payment orders,  │
   ┌───────────────►│  (this repo)         │        │  webhook events)  │
   │ HTTPS / REST    │                      │        └─────────────────┘
┌──┴───────────┐     │                      │        ┌─────────────────┐
│ Advocate     │     │                      │◄──────►│   AWS S3          │
│ (admin —     │     └──────────┬───────────┘        │ (case PDFs,       │
│  reviews,    │                │                     │  drafts, finals)  │
│  drafts)     │                │                     └─────────────────┘
└──────────────┘     ┌──────────▼───────────┐
                     │  PostgreSQL           │
                     │  (system of record)  │
                     └──────────────────────┘
```

Two human actors — the junior lawyer and the advocate (admin) — interact with
the same API under different permission sets (see `docs/low-level-design.md`
§RBAC). Two external systems are integrated: Razorpay for payment collection
and AWS S3 for document storage. PostgreSQL is the sole system of record;
there is no separate cache/read-store in v1 beyond Redis, which is used only
for rate-limit counters.

## 2. Containers

| Container | Responsibility | Notes |
|---|---|---|
| **API** (FastAPI, this repo) | All business logic, RBAC enforcement, state machine, request validation | Stateless — horizontally scalable behind a load balancer |
| **PostgreSQL** | Users, roles, cases, documents (metadata only), payments, audit log | Single primary in v1; see backlog for read-replica note |
| **Redis** | Rate-limit counters (`slowapi`) | Not used for sessions or caching yet — see backlog |
| **S3** | Binary storage for PDFs (original / draft / final) | API never proxies file bytes — see §4 |
| **Razorpay** | Payment collection, webhook-based confirmation | API never trusts client-reported payment success — see §4 |

## 3. Why these choices

- **FastAPI + async SQLAlchemy**: the workload is I/O-bound (DB + S3 +
  Razorpay calls per request), so async avoids thread-pool bottlenecks under
  load without adding a separate task-queue for the request path itself.
- **PostgreSQL native ENUM + ARRAY**: case status and role permissions are a
  closed, small set that changes rarely — native types give the DB itself a
  constraint instead of relying on application-only validation. Tradeoff:
  tests need a real Postgres instance (see `CLAUDE.md`), not sqlite.
- **Presigned S3 URLs instead of API file proxying**: keeps large PDF uploads
  off the API server entirely (memory, bandwidth, and timeout concerns), and
  keeps documents private by default — a signed URL is required, expiring in
  `S3_PRESIGNED_URL_EXPIRE_SECONDS`.
- **Webhook-confirmed payments**: a client (or a compromised client) reporting
  "I paid" is never sufficient to unlock a fee-gated action — only a
  signature-verified Razorpay webhook advances the state machine. See
  `app/services/payment_service.py::verify_webhook_signature`.
- **Permission-based RBAC over role-name checks**: new roles (e.g. a future
  "senior associate" tier) can be added by seeding a new row in `roles` with
  a permission set, without touching route code.

## 4. Deployment view (as shipped: `docker-compose.yml`)

```
┌──────────────────────────────────────────────┐
│ docker compose                                │
│                                                │
│  ┌──────────┐   ┌───────────┐   ┌──────────┐ │
│  │   api    │──►│    db     │   │  redis    │ │
│  │ (gunicorn│   │(postgres  │   │(rate      │ │
│  │ +uvicorn │   │  16)      │   │ limiting) │ │
│  │ workers) │   └───────────┘   └──────────┘ │
│  └────┬─────┘                                 │
└───────┼────────────────────────────────────────┘
        │
        ▼
   external: S3, Razorpay
```

Production deployment beyond `docker-compose` (e.g. ECS/K8s, managed
Postgres, a CDN in front of S3) is intentionally left to the deploying team —
see `docs/backlog.md` for what's explicitly out of scope for v1.

## 5. Non-functional notes

- **Rate limiting**: `slowapi`, default 100 req/min/IP, applied globally in
  `app/main.py`. Payment and webhook endpoints may need tighter, separate
  limits before production — see backlog.
- **Secrets**: all via environment variables (`.env`, never committed —
  `.gitignore` excludes it). `SECRET_KEY` must be a high-entropy random value
  in any real deployment, not the placeholder in `.env.example`.
- **Horizontal scaling**: the API container is stateless (JWT auth, no
  server-side sessions), so it scales by adding replicas behind a load
  balancer without sticky sessions.
