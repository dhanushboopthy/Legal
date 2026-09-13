# Low-level design (LLD)

Field-, endpoint-, and transition-level detail. Source of truth is always the
code (`app/models`, `app/routers`, `app/services`) — this document is a
navigable summary of it, kept close enough to reality to trust, but if the two
disagree, the code wins and this doc needs a fix.

## 1. Database schema

| Table | Key columns | Notes |
|---|---|---|
| `roles` | `id`, `name` (unique), `permissions` (text array) | Seeded by `scripts/seed_roles.py` from `core.permissions.ROLE_PERMISSIONS` |
| `users` | `id`, `email` (unique), `hashed_password`, `role_id` FK, `bar_council_id`, `is_active`, `is_verified` | New junior-lawyer signups have `is_active=False` until admin approval |
| `cases` | `id`, `junior_lawyer_id` FK, `status` (enum), `rejection_reason`, `revision_count` | `status` is the state-machine column — see §3 |
| `case_documents` | `id`, `case_id` FK, `type` (`original`/`draft`/`final`), `version`, `storage_key`, `uploaded_by` FK | `storage_key` is an S3 object key, never a public URL |
| `payments` | `id`, `case_id` FK, `type` (`review`/`drafting`/`revision`), `amount`, `status`, `gateway_order_id`, `gateway_payment_id` | `gateway_order_id` is unique per Razorpay order and is how webhooks find the row |
| `revision_requests` | `id`, `case_id` FK, `requested_by` FK, `reason`, `status` (`pending`/`resolved`) | One row per revision cycle; resolved when the next draft is delivered |
| `notifications` | `id`, `user_id` FK, `message`, `is_read` | In-app only in v1 |
| `audit_logs` | `id`, `user_id` FK (nullable — system-originated events have no user), `action`, `entity_type`, `entity_id`, `log_metadata` (JSON) | Append-only; never updated or deleted by application code |

Full column types/constraints: `alembic/versions/0001_initial_schema.py` (hand-written — see `CLAUDE.md` for why).

## 2. RBAC — permission matrix

| Permission | super_admin | junior_lawyer | clerk | accountant |
|---|:---:|:---:|:---:|:---:|
| `case:submit` | | ✔ | | |
| `case:view_own` | | ✔ | | |
| `case:view_all` | ✔ | | ✔ | |
| `case:decide` | ✔ | | | |
| `case:draft` | ✔ | | | |
| `case:request_revision` | | ✔ | | |
| `case:approve_final` | | ✔ | | |
| `payment:initiate` | | ✔ | | |
| `payment:view_own` | | ✔ | | |
| `payment:view_all` | ✔ | | | ✔ |
| `user:manage` | ✔ | | | |
| `audit:view` | ✔ | | | |

Enforcement point: `Depends(require_permission(PERMISSION_NAME))` on the
route. Row-level ownership (a junior lawyer seeing only *their* case) is a
second, separate check — `case_service.authorize_case_access()` — since
`case:view_own` alone can't express "which rows," only "this kind of row."

## 3. Case status state machine

| From | Action | Actor / permission | To | Side effects |
|---|---|---|---|---|
| `submitted` | pay review fee (webhook) | system (Razorpay webhook) | `review_fee_paid` | Payment row → `paid` |
| `review_fee_paid` | `PATCH /cases/{id}/decision {accept:false}` | `case:decide` | `rejected` | Sets `rejection_reason`; notifies junior lawyer |
| `review_fee_paid` | `PATCH /cases/{id}/decision {accept:true}` | `case:decide` | `accepted` | Notifies junior lawyer that drafting fee is due |
| `accepted` | pay drafting fee (webhook) | system | `drafting_fee_paid` | Payment row → `paid` |
| `drafting_fee_paid` | `POST /documents/confirm` (type=draft) | `case:draft` | `draft_delivered` | New `case_documents` row, version 1; notifies junior lawyer |
| `draft_delivered` | `POST /cases/{id}/revision` (within free quota) | `case:request_revision` | `revision_requested` | `revision_count += 1`; new `revision_requests` row |
| `draft_delivered` | `POST /cases/{id}/revision` (quota exceeded) | `case:request_revision` | *(unchanged — pending payment)* | Returns a Razorpay order for the revision fee instead |
| *(after revision payment webhook)* | pay revision fee | system | `revision_requested` | `revision_count += 1` |
| `revision_requested` | `POST /documents/confirm` (type=draft) | `case:draft` | `draft_delivered` | Resolves the pending `revision_requests` row; new document version |
| `draft_delivered` | `POST /cases/{id}/approve` | `case:approve_final` | `completed` | Terminal state |

Guard implementation: `case_service._assert_status()` checks the current
status against `_REQUIRES_STATUS_FOR[action]` before any mutation; an
out-of-order call raises `ConflictError` → HTTP 409, not a corrupted state.

## 4. API contract summary

| Method & path | Permission | Request | Response |
|---|---|---|---|
| `POST /auth/register` | none (public) | `UserRegister` | `UserOut` (inactive) |
| `POST /auth/login` | none | OAuth2 form | `Token` |
| `POST /auth/refresh` | valid refresh token | `RefreshRequest` | `Token` |
| `PATCH /users/{id}/approve` | `user:manage` | — | `UserOut` |
| `POST /cases` | `case:submit` | `CaseCreate` | `CaseOut` |
| `GET /cases` | any authenticated | — | `list[CaseOut]` (own or all, by permission) |
| `GET /cases/{id}` | ownership or `case:view_all` | — | `CaseOut` |
| `POST /cases/{id}/review-payment` | ownership | — | `PaymentOrderResponse` |
| `POST /cases/{id}/drafting-payment` | ownership | — | `PaymentOrderResponse` |
| `PATCH /cases/{id}/decision` | `case:decide` | `CaseDecision` | `CaseOut` |
| `POST /cases/{id}/revision` | `case:request_revision` | `RevisionCreate` | `CaseOut` or `PaymentOrderResponse` |
| `POST /cases/{id}/approve` | `case:approve_final` | — | `CaseOut` |
| `POST /documents/upload-url` | ownership (original) or `case:draft` (draft/final) | `UploadUrlRequest` | `UploadUrlResponse` (presigned PUT) |
| `POST /documents/confirm` | same as above | `ConfirmUploadRequest` | `DocumentOut` |
| `GET /documents/{id}/download-url` | ownership | — | presigned GET URL |
| `POST /webhooks/razorpay` | signature-verified, not JWT | Razorpay event | `{"status": "ok"}` |

## 5. Sequence: full happy path (submission → completion)

```
Junior lawyer                API                          Razorpay / S3
     │  POST /cases                │                              │
     │─────────────────────────────►│ status=submitted             │
     │  POST /documents/upload-url  │                              │
     │─────────────────────────────►│───(presigned PUT)───────────►│ (client PUTs PDF directly)
     │  POST /documents/confirm     │                              │
     │─────────────────────────────►│ case_documents row (original)│
     │  POST /cases/{id}/review-payment                            │
     │─────────────────────────────►│───create order──────────────►│
     │◄─────────────────────────────│ order_id, key                │
     │  (pays via Razorpay checkout)│                              │
     │                              │◄───webhook: payment.captured─│
     │                              │ status=review_fee_paid       │
                              [admin] PATCH /cases/{id}/decision {accept:true}
                              │ status=accepted                    │
     │  POST /cases/{id}/drafting-payment                          │
     │─────────────────────────────►│───create order──────────────►│
     │◄─────────────────────────────│                              │
     │  (pays)                      │◄───webhook────────────────────│
     │                              │ status=drafting_fee_paid     │
                              [admin] uploads draft (upload-url + confirm)
                              │ status=draft_delivered             │
     │  POST /cases/{id}/approve    │                              │
     │─────────────────────────────►│ status=completed             │
```

## 6. Security details

- **JWT**: access token (short-lived, `ACCESS_TOKEN_EXPIRE_MINUTES`) and
  refresh token (`REFRESH_TOKEN_EXPIRE_DAYS`), both HMAC-signed
  (`SECRET_KEY`, HS256). Token `type` claim (`access`/`refresh`) is checked
  explicitly so a refresh token can't be used as an access token.
- **Passwords**: bcrypt via `passlib`.
- **Webhook signatures**: HMAC-SHA256 of the raw request body against
  `RAZORPAY_WEBHOOK_SECRET`, constant-time compared
  (`hmac.compare_digest`) — see `payment_service.verify_webhook_signature`.
- **Document access**: never a stored public URL — every read/write goes
  through a freshly generated, time-limited presigned S3 URL
  (`S3_PRESIGNED_URL_EXPIRE_SECONDS`, default 300s).
