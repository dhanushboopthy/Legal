# Backlog

## Shipped in this repo (v1)

- Junior lawyer registration with admin approval gate
- JWT auth (access + refresh), RBAC via permission-per-role
- Case submission, review, accept/reject, drafting, revision (free + paid
  tiers), approval — full state machine
- Razorpay order creation + webhook-verified payment confirmation for all
  three fee types (review, drafting, revision)
- S3 presigned upload/download for case documents, versioned
- Append-only audit log tied to the same DB transaction as each action
- In-app notifications on status changes
- Alembic migration, idempotent role-seeding script, Dockerfile + compose

## P0 — before a real launch

- **Legal/compliance review of the fee model.** *As the practice owner, I
  need confirmation that charging junior lawyers ₹100/₹400 per case is
  compliant with Bar Council of India rules on fee-splitting and touting,
  so the business model itself is sound before more engineering goes into
  it.* Not something this codebase can resolve — needs a person qualified
  to advise on it.
- **Refund/failure handling for payments.** *As a junior lawyer whose payment
  fails or whose case is later disputed, I want a defined refund path, so
  I'm not stuck in limbo.* Today `PaymentStatus.REFUNDED` exists as an enum
  value but nothing sets it — no refund endpoint or Razorpay refund-webhook
  handling yet.
- **Rate limits on payment/webhook endpoints specifically.** The global
  100/min limit isn't tuned for `/webhooks/razorpay` (should be generous,
  keyed differently) vs. `/cases/{id}/*-payment` (should be tighter, keyed
  per-user to prevent order-creation spam).
- **Secrets management for production.** `.env` works for dev; production
  needs `SECRET_KEY`, DB credentials, and the Razorpay/AWS keys out of a
  proper secret store, not a file.

## P1 — near-term

- **SLA reminders.** *As an admin, I want to see (and have junior lawyers
  notified about) cases that have sat unreviewed for N hours, so nothing
  silently stalls.* Needs a scheduled job (Celery beat, or a simple cron
  hitting an internal endpoint) — no background job runner exists yet.
- **Separate "final signed filing" step.** *As a junior lawyer, I want the
  final filing to be distinguishable from an intermediate draft, and ideally
  digitally signed, so I have a clean audit trail of what was actually
  filed.* Today `approve` just marks the last draft as final; there's no
  `DocumentType.FINAL` upload step or e-signature integration
  (India: IT Act 2000 / Aadhaar eSign or a DSC).
- **Email/SMS delivery for notifications.** In-app `notifications` rows exist;
  nothing pushes them out yet.
- **Invoice generation.** *As either party, I want a downloadable receipt per
  payment,* not just a `payments` row queryable via API.

## P2 — future

- **Dispute resolution flow.** A structured way to flag a completed or
  rejected case as disputed, rather than an informal conversation outside
  the system.
- **Ratings/feedback** from junior lawyer to advocate (or vice versa) per
  completed case.
- **Admin dashboard/reporting** beyond the existing list/detail JSON
  endpoints — case volume, revenue, average turnaround time.
- **Dedicated clerk/accountant routes.** Both roles are seeded with
  permissions (`case:view_all`, `payment:view_all` respectively) but today
  they just reuse existing endpoints gated by that permission — no
  clerk-specific workflows (e.g. uploading on the admin's behalf) exist yet.
- **CI pipeline** (GitHub Actions or equivalent) running `alembic upgrade
  head` + `pytest` against a service-container Postgres on every PR — not
  included in this repo.
- **Horizontal scale-out specifics**: read replicas, connection pooling at
  the infra layer (PgBouncer), CDN in front of S3 for download URLs — all
  deferred until there's real traffic to justify them.
