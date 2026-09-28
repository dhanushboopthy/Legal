---
name: ux-principles
description: UX rules and copy guidelines for the legal case-filing platform. Read before any UI change, screen, flow or piece of user-facing text.
---

> **Draft, review me.** Written from `docs/UX_REDESIGN_PLAN.md` §1 and `docs/UX_DISCOVERY.md` §12. Edit freely.

The product should need no manual. Every screen answers three things without reading: **where am I, whose turn is it, what is the one thing to do next.**

## Audience

The people using this are often **older lawyers who may be new to technology**. Design for someone who reads slowly, uses a mouse carefully, may have reduced vision, and won't guess at icons:

- Text is a comfortable 16 px body and dark; secondary text is still easy to read. The owner found 17 px too big — keep 16 px as the default and let the Text size setting go larger.
- Every button is big (≥44 px) and says what it does in words. Icon-only buttons are a last resort for tight spaces, always with an `aria-label`.
- Nothing important is only on hover (no tooltip-only labels or dates).
- Errors stay on screen until dismissed. Nothing times out on someone reading slowly.
- Every inner page has a visible way back ("← All cases") and a page title.
- Plain words: "5 min ago", not "5m"; "Bar Council enrolment number", not "BCI ID".
- The Text size setting (Normal / Large / Extra large) must never break a layout: check pages at Extra large on a 360 px phone.

## North-star tests

| Person | Test |
|---|---|
| Junior | Files in hand, submits and pays ₹100 in under 2 minutes and 3 taps after choosing files. |
| Junior | On any case, knows what happens next and whose turn it is within 5 seconds. |
| Junior | Never sees a pay button without the amount on it. |
| Advocate | Opens the app and sees what needs them, in one list, without opening cases. |
| Advocate | Decides a case in 2 taps; sends draft and quote in one sheet with one confirmation. |
| Both | Everything works on a 360 px phone, at every text size. |
| Both | Someone who forgot their password gets back in without calling anyone. |

## Rules

1. **One primary action per screen state.** Everything else is secondary (text or ghost button).
2. **Say whose turn it is.** "Your turn" / "Waiting on the advocate" beats a status name.
3. **Money first.** The amount is on the button that spends it ("Pay ₹2,500 to unlock"). Amounts come from the server, never hard-coded in the UI.
4. **Describe the person's situation, not system state.** "Draft ready: pay to unlock", not "quoted".
5. **Every async thing has feedback**: pending, success, failure, and a timeout that says what to do ("Taking longer than usual. Your payment is safe.").
6. **Errors say what happened and what to do.** Surface the server's `detail`; never a bare "Something went wrong" for a failure we know the cause of.
7. **Confirm irreversible actions, and name the thing**: "Refund ₹100 to Priya for 'Bail petition'?" One confirmation, not two.
8. **No dead ends.** Rejected, refunded, expired and empty states each offer a next step.
9. **Don't make people retype** (credentials, emails, form values) or re-navigate after a refresh.
10. **Loading, empty and error are three different states.** A failed request must never render "No X yet".

## Copy

- The senior who reviews and drafts is **"advocate"**. The junior who submits is **"lawyer"**. Never "admin", "senior", "super admin" or "junior lawyer" in UI text.
- Currency is always `₹1,00,000` via `formatCurrency`; never "Rs." (server notification text still says "Rs." until Phase 1: fix it there).
- Buttons are verbs with the object: "Send draft and quote", not "Submit".
- No jargon for internal states (`review_fee_paid`). Status labels live in one place (`statusMeta`).
- Sentence case. No exclamation marks. Short.

## Friction checklist (from `docs/UX_DISCOVERY.md`)

Use as a review list; IDs map to the audit.

| Area | Check | Findings |
|---|---|---|
| Money | Fee shown before asking to pay; no double orders; refund policy stated | F-02, F-10, F-17 |
| Waiting | Payment/approval/decision waits have a timeout state and a "check status" path | F-06, F-12 |
| Notifications | Both roles are notified; each links to its case | F-03, F-16 |
| Errors | Server message shown; load failure is not "empty" | F-13, F-14, F-26 |
| Safety | Irreversible actions confirmed; wrong file can't go out instantly | F-09, F-21 |
| Dead ends | Rejection, final download, old drafts reachable | F-05, F-17, F-22 |
| Onboarding | Few screens, no double credential entry, Bar Council ID collected for everyone | F-11, F-20 |
| Identity | Human-readable case number, submitter name and Bar ID visible to the advocate | F-19, F-29 |
| Forms | Limits enforced client-side; option lists instead of free text | F-24, F-27 |
| Access | Names for icon buttons, `aria-invalid`, `role="alert"`, AA contrast, reduced motion | F-25 |
| Nav | Reachable on mobile; one "New case" button | F-08, F-30 |
| Downloads | Anchor click, not `window.open` after an async call | F-31 |
