---
name: flow-simplification
description: Information architecture, case lifecycle and the single primary action per status and role. Read when designing or changing a screen flow, the case page, or what a status shows.
---

> **Draft, review me.** Distilled from `docs/NEW_FLOW_SPEC.md` §3 and `docs/UX_REDESIGN_PLAN.md` §2.

**A case is a conversation.** The case page is a header, one pinned action card, and the chat. Files and details are sheets, not sections. Navigation is a top bar on desktop and a bottom tab bar on mobile (Cases; advocate also People and Payments).

## Rules

1. Exactly **one primary action** per status per role. Other actions are text or ghost buttons.
2. Say whose turn it is on the list row and on the card ("Your turn" chip / "Waiting on the advocate").
3. Fewer steps beats more screens: merge steps that always happen together (create case + upload + submit + pay ₹100 is one button).
4. Nothing is lost on failure: every multi-step flow is resumable (unfinished draft resumes, never duplicates).
5. Exactly one "New case" button per screen.
6. Permissions decide what shows (`can('quote:create')`), never the role name.

## Primary action per status

Statuses and labels come from `docs/NEW_FLOW_SPEC.md` §3; the labels themselves live in `statusMeta`.

| Status | Junior (lawyer) | Advocate |
|---|---|---|
| `draft` | **Submit and pay ₹100** (files first; case is hidden from the advocate) | not visible |
| `submitted` | **Pay ₹100** | none (awaiting payment) |
| `review_fee_paid` | none (in review) | **Accept** / Decline (reason chips, then confirm) |
| `rejected` | **Start a new case** (prefilled); reason and fee statement shown | none |
| `accepted` | Chat: discuss details | **Send draft and quote** (one sheet, one confirmation naming lawyer and amount) |
| `quoted` | **Pay ₹X to unlock** (locked draft card: name, pages, size, date, advocate's note) | none; secondary "Replace draft or change amount" |
| `delivered` | **Download**; secondary Approve, Request changes | none (delivered) |
| `revision_requested` | none; shows what was asked | **Upload new version** |
| `completed` | **Download** latest; chat read-only | none; chat read-only |

## Cases list

- **Junior**: own cases as an inbox. Row = title, last message or next-step line, time, unread badge, "Your turn" chip.
- **Advocate**: grouped **Needs you** / **Waiting on lawyer** / **Done**. Row adds lawyer name and Bar Council ID. Search by title, lawyer, case number.
- Desktop may split list | case like a messaging app; mobile is two screens.

## Money and files

- Download access is decided by the server (`403 payment_required`); the UI only reflects `locked`.
- After payment, new draft versions are free and immediately downloadable.
- After a refund the draft shows a "Refunded" card and stays locked; the case status does not roll back.
- Payment feedback: "Confirming your payment" → after 60 s "Taking longer than usual. Your payment is safe." + "Check status" → success card with a Download button, or a failure card with Retry.

## Onboarding (Phase 5, pending the approval-gate decision)

One sign-in screen with Google and email; sign-up asks name, email, password; Bar Council ID for everyone in one follow-up step; OTP auto-submits at 6 digits; a pending user waits on a page that re-checks and moves on by itself.
