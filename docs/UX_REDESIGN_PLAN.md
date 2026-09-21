# UX Redesign Plan

Inputs: `docs/UX_DISCOVERY.md` (audit, finding IDs F-01 to F-35), `docs/NEW_FLOW_SPEC.md` (new flow).
Skills to load before any UI work: `.claude/skills/ux-principles`, `design-system`, `flow-simplification`, `ui-implementation`.

## 1. North star

The product should need no manual. Success looks like this:

| Person | Test |
|---|---|
| Junior | With files in hand, submits and pays ₹100 in under 2 minutes and 3 taps after choosing files. |
| Junior | On any case, answers "what happens next and whose turn is it?" within 5 seconds. |
| Junior | Never sees a payment button without the amount on it. |
| Advocate | Opens the app and sees exactly what needs him, in one list, without opening cases. |
| Advocate | Decides a case in 2 taps. Sends draft and quote in one sheet with one confirmation. |
| Both | Everything works on a 360 px phone. |

## 2. New information architecture

Old: dashboard, case detail with per-status cards, profile, admin pages, notification bell.
New: **a case is a conversation.**

| Screen | Junior | Advocate |
|---|---|---|
| Cases (home, inbox-style list) | Own cases. One "New case" button. Row: title, last message or next-step line, time, unread badge, "Your turn" chip. | Grouped: **Needs you**, **Waiting on lawyer**, **Done**. Row also shows lawyer name and Bar ID. |
| New case | Drop files first. Case type list. Title auto-filled. **Submit and pay ₹100**. | n/a |
| Case | Header with status. One pinned **action card**. Chat below. Files and details open in sheets. | Same layout. Action card has Accept or Decline, or **Send draft and quote**. |
| People | n/a | Approve lawyers (name, email, Bar ID). |
| Payments | n/a | Table with lawyer and case columns, confirm before refund. |
| Profile | Sheet from the avatar menu, editable. | Same. |

Navigation: top bar on desktop, **bottom tab bar on mobile** (Cases, and for the advocate People and Payments).
Desktop Cases screen can use a split view (list left, case right) like a messaging app. On mobile the list and the case are separate screens.

### Case screen (mobile)

```
+--------------------------------------+
| <  Bail petition                     |
|    With Adv. <name>                  |
+--------------------------------------+
| ACTION CARD (one per status and role)|
| Draft ready                          |
| [lock] Bail-application.pdf, 8 pages |
| Advocate's note: "Includes annexures"|
| [ Pay Rs 2,500 to unlock ]           |
+--------------------------------------+
|              Today                   |
|  (Please share the FIR copy)         |
|            (Sharing it now)  Seen    |
|  [system] Quote sent: Rs 2,500       |
+--------------------------------------+
| [+]  Message                    [>]  |
+--------------------------------------+
```

### Send draft and quote sheet (advocate)

```
Send draft and quote
Draft (PDF)     [ Choose file ]   Bail-application.pdf, 8 pages
Amount          Rs [ 2500 ]
Note (optional) [                              ]
The lawyer pays this amount to unlock the download.
[ Send to Priya for Rs 2,500 ]        (one confirmation, shows name and amount)
```

## 3. Phases

Sizes: S under 1 day, M 1 to 3 days, L 3 to 6 days. Run phases in order, except that Phase 0 tasks 0.3 and 0.4 can run in parallel with Phase 1.

### Phase 0. Foundations (M)

| # | Task |
|---|---|
| 0.1 | `GET /users/me` returns `permissions[]`. Add `usePermissions().can('...')`. Replace every `role_name === ...` check in `App.tsx`, `case-detail-page.tsx`, `dashboard-page.tsx`, `app-shell.tsx`. |
| 0.2 | One `statusMeta` map: label, tone, whose turn (per role), next-step sentence. Pills, list rows and the action card read from it. Remove dead statuses. Use the labels from `NEW_FLOW_SPEC.md` section 3. |
| 0.3 | Fix tokens per `design-system` (contrast, named type scale, system font stack, darker hover). |
| 0.4 | Shared pieces: `Field` (wired `aria-invalid` and `aria-describedby`), `ErrorState`, `ConfirmDialog`, `Sheet`, `getErrorMessage(err)` that surfaces the server `detail` and handles FastAPI 422 arrays. |
| 0.5 | Every query-backed screen renders loading, empty and error as three different states. |

Resolves F-13, F-14, F-23, F-34, D1 to D12, part of F-25.
Done when: no screen shows "No X yet" for a failed request, and no component reads `role_name`.

### Phase 1. Backend: quote, gating, payments (L)

| # | Task |
|---|---|
| 1.1 | Alembic migration: new statuses, `quotes`, `payments.quote_id`, `case_documents` extra columns, permissions seed. Use autocommit for enum `ADD VALUE`. |
| 1.2 | One transition table in `case_service` (from, to, actor, permission). Exhaustive unit tests. Delete dead enum values. |
| 1.3 | `POST /cases/{id}/quote` (atomic: confirm draft, create quote, set `quoted`). Replace flow in `quoted`. Bounds from config. |
| 1.4 | Payments: order amount from the quote row, reuse pending order, webhook checks order and amount, idempotent, status-guarded, auto-refund on superseded capture, `reconcile` endpoint. |
| 1.5 | Download gating and `locked` metadata (`NEW_FLOW_SPEC.md` section 5). |
| 1.6 | Remove drafting and revision fixed-fee paths and config. `revision` becomes free "request changes". |
| 1.7 | RBAC test matrix: every actor x status x document type x endpoint. |
| 1.8 | Advocate notifications (new paid case, quote paid, changes requested). |

Resolves F-03 (backend part), F-04 (revision reason readable), F-10, F-12 (backend), F-26, F-35, F-05 (backend).
Done when: a junior calling `download-url` on an unpaid draft gets 403 `payment_required`; replaying a webhook changes nothing; a client-sent amount is ignored.

### Phase 2. Multi-file upload (M)

| # | Task |
|---|---|
| 2.1 | Backend: whitelist, `upload-urls`, `confirm-batch` with magic-byte check, limits, `submit`, stale draft purge job. |
| 2.2 | `Dropzone` component: multi-select, drag and drop, per-file row with progress, remove, retry; 3 in parallel; type and size errors shown before upload starts. |
| 2.3 | New case screen: files first, case type from a list, title prefilled from the first file name, optional note. One primary button: **Submit and pay ₹100**. Resume an unfinished draft instead of creating a duplicate. |

Resolves F-01, F-02 (review fee shown), F-15, F-24, F-27.
Done when: 5 mixed files upload in one selection, a failed upload can be retried without creating a second case, and the fee is visible on the button.

### Phase 3. Case chat (L)

| # | Task |
|---|---|
| 3.1 | Tables and REST: messages, read cursors, attachments. Permission `case:message`, status gates, rate limit, `client_id` idempotency. |
| 3.2 | System messages emitted by services in the same transaction (accepted, quote, payment, new draft, changes requested, completed). |
| 3.3 | Thread UI (spec in `design-system`): grouped bubbles, day separators, unread divider, Seen, optimistic send with retry, multi-file attachments, scroll to latest, mobile keyboard safe (`100dvh`, `visualViewport`). |
| 3.4 | Polling: 3 s in an open thread, 30 s in the list. |
| 3.5 | WebSocket with ticket auth, Redis pub/sub, nginx upgrade config, polling fallback, backoff reconnect. |
| 3.6 | Notifications: in-app per new message (collapsed), email after 10 minutes unread. |

Resolves F-03, F-16.
Done when: two browsers see each other's messages within a second (after 3.5), a refresh keeps scroll and unread state, a message sent offline retries once without duplicating.

### Phase 4. Cases list and case screen redesign (L)

| # | Task |
|---|---|
| 4.1 | Cases list as inbox (section 2). Cursor pagination. Search by title, lawyer name, case number. Exactly one "New case" button. |
| 4.2 | Case screen: header, pinned action card driven by `statusMeta` and permissions, compact progress indicator, chat, Files sheet, Details sheet. |
| 4.3 | Junior actions: pay ₹100, pay ₹X to unlock (locked draft card), download, approve (confirm names the case), request changes (opens the composer with a prefilled prompt). |
| 4.4 | Advocate actions: Accept, Decline (with reason chips), **Send draft and quote** sheet, replace draft before payment, see all draft versions. |
| 4.5 | Payment feedback: success card ("Payment received. Your draft is unlocked." with a Download button), timeout copy after 60 s with "Check status", failed-payment card with Retry. |
| 4.6 | Rejected state: reason, fee statement, "Start a new case" prefilled. |
| 4.7 | Downloads never use `window.open` after an async call (popup blockers, F-31). Use an anchor click. Latest paid draft stays downloadable after completion. |
| 4.8 | Admin People and Payments pages: lawyer and case columns, confirm before refund and approve. Mobile bottom tab bar. |

Resolves F-04, F-05, F-07, F-08, F-09, F-12 (UI), F-17, F-18, F-19, F-21, F-22, F-30, F-31.
Done when: the advocate can go from app open to draft-and-quote sent in under 6 taps, and every status has exactly one visible primary action.

### Phase 5. Onboarding and account (M)

Depends on the owner's answer about the approval gate (spec Q8 in `UX_DISCOVERY.md`).

| # | Task |
|---|---|
| 5.1 | One sign-in screen: Google and email. Sign-up asks name, email, password. Bar Council ID collected for **all** signups, including Google, in one follow-up step. |
| 5.2 | OTP: auto-submit at 6 digits, email survives refresh (`sessionStorage`), resend timer visible. |
| 5.3 | Pending approval without re-login: verified but inactive users get a limited session, the screen re-checks `/users/me` and moves to Cases on approval. Send an approval email. |
| 5.4 | Editable profile (phone, Bar ID). Remove dead phone field or use it. |
| 5.5 | Human-readable case numbers (for example `LF-2026-0042`) shown everywhere and searchable. |
| 5.6 | Login redirect keeps query and hash. Give refresh calls their own rate-limit bucket in the BFF. |

Resolves F-06, F-11, F-20, F-28, F-29, F-32, F-33.
Done when: a new junior goes from first visit to Cases without typing credentials twice.

### Phase 6. Polish and quality (M)

| # | Task |
|---|---|
| 6.1 | Accessibility pass with axe: names for icon buttons (avatar, bell), focus order in sheets, `role="alert"` for errors, 44 px touch targets on mobile, `prefers-reduced-motion`. |
| 6.2 | Performance: lazy-load routes, measure bundle and load time (currently not measured), drop page-transition animation or keep it under 150 ms. |
| 6.3 | Tests: Vitest and Testing Library for new case upload, payment states, chat send and retry, quote sheet; a Playwright happy path if the team wants e2e. |
| 6.4 | Copy pass with the `ux-principles` checklist. Test at 360 px and 1280 px. |

Resolves F-25 fully and closes the remaining Low items.

## 4. Finding to phase map

| Phase | Findings |
|---|---|
| 0 | F-13, F-14, F-23, F-34, part of F-25 |
| 1 | F-03, F-04, F-05, F-10, F-12, F-26, F-35 (backend sides) |
| 2 | F-01, F-02, F-15, F-24, F-27 |
| 3 | F-03, F-16 |
| 4 | F-04, F-05, F-07, F-08, F-09, F-12, F-17, F-18, F-19, F-21, F-22, F-30, F-31 |
| 5 | F-06, F-11, F-20, F-28, F-29, F-32, F-33 |
| 6 | F-25 |

## 5. Add to `CLAUDE.md`

```
## UX work
- Before any UI change, read .claude/skills/ux-principles and design-system.
- The product flow is defined in docs/NEW_FLOW_SPEC.md. The plan is docs/UX_REDESIGN_PLAN.md. Do not skip phases.
- Gate UI by permissions from /users/me, never by role_name.
- Every screen designs loading, empty, error and success states.
- Money is always visible before any pay action. Amounts come from the server.
- Download access is enforced on the server, never only in the UI.
```

## 6. Kick-off prompts for Claude Code

Use one per phase, in a fresh session:

```
Read CLAUDE.md, docs/NEW_FLOW_SPEC.md, docs/UX_REDESIGN_PLAN.md and the four skills in .claude/skills.
Implement Phase <N> tasks <list>. Work task by task. After each task run the checks in ui-implementation
(typecheck, lint, tests, build) and fix failures before continuing. Do not start the next phase.
End with: what changed, which findings are resolved, what you could not verify, and any decision you need from me.
```
