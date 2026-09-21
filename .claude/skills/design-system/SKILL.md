---
name: design-system
description: Design tokens, type scale, components and the chat-thread spec for frontend/web. Read before touching styles, adding a component, or building the case chat.
---

> **Draft, review me.** Derived from `frontend/web/src/index.css` and `docs/UX_DISCOVERY.md` §7. Contrast figures are computed (WCAG 2.x), not eyeballed.

Source of truth is `frontend/web/src/index.css` (`@theme` + `:root`). Single light theme. Tailwind 4, Radix primitives, `lucide-react` icons (stroke 1.5–1.75).

## Colour tokens

A **fill** colour is for backgrounds, borders and icons (needs 3:1). An **ink** colour is for *text* on a tint of that fill (needs 4.5:1). Never put a fill colour on small text.

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--color-accent` | `#0071e3` | primary button fill | white on it 4.70 |
| `--color-accent-hover` | `#0066cc` (was `#0077ed`, lighter than base and 4.32) | hover | white on it 5.57 |
| `--color-accent-active` | `#005bb8` | pressed | 6.59 |
| `--color-accent-ink` | `#005bb8` | links, info pills | ≥5.30 on white/bg/tint |
| `--color-success` / `-ink` | `#16a34a` / `#166534` | icon+fill / text | ink ≥5.91 (fill text was 2.96 on its pill) |
| `--color-warning` / `-ink` | `#d97706` / `#92400e` | icon+fill / text | ink ≥5.87 (fill text was 2.86) |
| `--color-danger` / `-ink` | `#dc2626` / `#b91c1c` | fill+danger button / text | ink ≥5.09; white on fill 4.83 |
| `--fg` | `#1d1d1f` | text | 15.5 on bg |
| `--fg-muted` | `#636366` (was `#6e6e73`, 4.07 on the neutral pill) | secondary text | ≥4.80 everywhere used |
| `--bg` / `--bg-elevated` | `#f5f5f7` / `#ffffff` | page / card | |
| `--border` | `rgba(0,0,0,.08)` | | |

Pills: `bg-{tone}/10` fill with `text-{tone}-ink`. Status colours always come from `statusMeta`, not per-component.

## Type scale (named, min 12 px)

Replace arbitrary `text-[11px|12px|13px|15px]` with named steps: `text-caption` 12, `text-label` 13, `text-sm` 14 (body), `text-lead` 15, `text-base` 16 (card title, semibold), `text-2xl` 24 (page title, semibold, tracking-tight). Font: system stack, no unloaded webfont: `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif`.

## Layout

Gutter `px-4` on mobile, `px-6` from `sm`. Content widths: auth `max-w-sm`, forms `max-w-xl`, case `max-w-2xl`, lists `max-w-5xl`. Radii: card `1.25rem`, control `0.75rem`. Touch targets ≥44 px on mobile (`min-h-11`); desktop buttons `h-10` (md). Bottom tab bar on mobile, top bar from `sm`. Page transitions ≤150 ms or none.

## Components and when to use which

| Need | Use |
|---|---|
| Form field with label + error | `Field` (wires `aria-invalid`, `aria-describedby`, error `role="alert"`) |
| Field-level validation error | inline under the field |
| Confirmation of a finished, non-blocking action | toast (success/error, 4 s) |
| A page-level load that failed | `ErrorState` with retry (inline) |
| Whole-screen state (404, 403, crash, pending approval) | `StatusPage` |
| A list that succeeded with zero rows | `EmptyState` (only then) |
| Irreversible action | `ConfirmDialog` (names the thing) |
| Secondary detail (files, case details) | `Sheet` (bottom on mobile, right on desktop) |
| Filters | `Tabs`, not hand-styled buttons |
| Upload | `Dropzone` (one shared component; not raw dashed buttons) |
| Error text from an API failure | `getErrorMessage(err)` — server `detail`, FastAPI 422 arrays, network failure, fallback |

Every query-backed view designs **loading (skeleton) / empty / error / success**.

## Chat thread (NEW_FLOW_SPEC §7)

- **Bubbles**: own right, accent fill, white text; other left, white surface. Group consecutive messages from one sender within 5 minutes (tight spacing, tail on the last).
- **Day separators**: "Today", "Yesterday", then a date. **Unread divider**: "New messages" before the first message after the reader's last-read id.
- **System messages** (accepted, quote sent/updated, payment, new draft, changes requested, completed): centred, muted, `text-caption`. **Quote and draft cards**: full-width cards in the thread, not bubbles; the draft card shows a lock until paid.
- **Seen** under the sender's last message once the other party's read cursor passes it.
- **Send**: optimistic bubble → "Sending…" → failed state with Retry/Remove. Retry reuses the same `client_id` so it never duplicates.
- **Attachments**: up to 5, chips with icon, name, size. PDF and images preview inline; DOC/DOCX download only.
- **Composer**: `+` attach, autosizing textarea (max 4 lines). Desktop Enter sends, Shift+Enter newline; mobile Enter is newline with an explicit send button. Counter appears at 3,500/4,000. Read-only note in `completed`.
- **Text is plain**, never HTML; URLs auto-linked with `rel="noopener noreferrer"`.
- **Scroll**: stick to the bottom when near it, otherwise show a "New messages ↓" pill.
- **Mobile keyboard**: container `h-dvh`; follow `visualViewport` resize so the composer stays above the keyboard.
