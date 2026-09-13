# High-level design (HLD)

Companion to `docs/architecture.md` (system/container view) and
`docs/low-level-design.md` (field- and endpoint-level detail). This document
covers the functional modules inside the API container and how they interact.

## 1. Functional modules

| Module | Files | Responsibility |
|---|---|---|
| **Auth & identity** | `routers/auth.py`, `routers/users.py`, `core/security.py` | Registration (junior lawyer, pending approval), login, JWT issue/refresh, admin approval of new accounts |
| **RBAC** | `core/permissions.py`, `dependencies.py`, `models/role.py` | Permission constants, role→permission seeding, the `require_permission()` dependency used on every protected route |
| **Case lifecycle** | `services/case_service.py`, `routers/cases.py`, `models/case.py` | The status state machine — submission, decision, drafting, revision, approval |
| **Payments** | `services/payment_service.py`, `routers/payments.py`, `routers/webhooks.py`, `models/payment.py` | Razorpay order creation, webhook signature verification, payment-to-status advancement |
| **Documents** | `services/storage_service.py`, `routers/documents.py`, `models/document.py` | Presigned S3 upload/download URLs, document metadata + versioning |
| **Notifications** | `services/notification_service.py`, `models/notification.py` | In-app notification rows created alongside state changes (email/SMS delivery is a backlog item, not implemented) |
| **Audit** | `services/audit_service.py`, `models/audit_log.py` | Append-only log of who did what to which entity, written in the same transaction as the action itself |

## 2. Module interaction (a single request, e.g. "admin accepts a case")

```
Client
  │  PATCH /cases/{id}/decision  {accept: true}
  ▼
routers/cases.py :: decide_case()
  │  Depends(require_permission(CASE_DECIDE))   ──► dependencies.py checks role.permissions
  │  case_service.get_case_or_404()             ──► loads Case row
  ▼
services/case_service.py :: decide_case()
  │  _assert_status(case, "decide")              ──► guards against invalid transitions
  │  case.status = ACCEPTED
  │  audit_service.log_action(...)               ──► same session, not yet committed
  │  notification_service.notify(...)            ──► same session, not yet committed
  ▼
routers/cases.py :: await db.commit()            ──► case update + audit row + notification
                                                       all commit atomically, or none do
```

This "service mutates + flushes, router commits" split is deliberate — see
`CLAUDE.md` conventions — so that a case transition and its audit trail can
never diverge.

## 3. The case status state machine (module-level view)

`case_service.py` is the single place case status can change. Every other
module that needs to react to a status change (payments unlocking the next
fee, notifications firing) is called *from* case_service or payment_service,
never the reverse — this keeps the state machine from being mutated from
multiple unsynchronized places. Full transition table: `docs/low-level-design.md`.

## 4. Cross-cutting concerns

- **Error handling**: every module raises from the `AppError` hierarchy
  (`core/exceptions.py`) rather than raw `HTTPException`, so `main.py` has one
  place (`app_error_handler`) that maps domain errors to HTTP responses and
  logs them consistently.
- **Ownership vs. permission**: RBAC (`require_permission`) answers "can this
  role do this kind of thing at all"; `case_service.authorize_case_access()`
  separately answers "does this specific user own this specific row" — the
  two checks are intentionally not merged into one dependency, since
  ownership needs the loaded row and permission doesn't.
- **Idempotency**: webhook handling (`payment_service.handle_payment_captured`)
  is idempotent on `gateway_order_id` — a redelivered webhook is a no-op, not
  a double-advance of the state machine.

## 5. What's explicitly not in this module set (see backlog)

- A scheduling/reminder module (SLA nudges for un-reviewed cases).
- A digital-signature module for the final filing (today "draft" and "final"
  share the same document type and endpoint).
- A dispute-resolution or ratings module.
- An admin-facing dashboard/reporting module beyond the raw list/detail
  endpoints already present.
