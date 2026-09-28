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
| `--fg-muted` | `#48484a` (was `#636366`) | secondary text | ~9:1 on bg |
| `--bg` / `--bg-elevated` | `#f5f5f7` / `#ffffff` | page / card | |
| `--border` | `rgba(0,0,0,.14)` | card and divider edges | |
| `--border-strong` | `#86868b` | form-control and secondary-button edges | 3:1 on white (WCAG 1.4.11) |

Pills: `bg-{tone}/10` fill with `text-{tone}-ink`. Status colours always come from `statusMeta`, not per-component.

## Type scale (named, min 13 px)

Named steps, all in rem: `text-caption` 13, `text-label` 14, `text-sm` 16 (**body**, redefined from Tailwind's 14), `text-lead` 17, `text-base` 18 (card title, semibold), `text-lg` 20, `text-xl` 22, `text-2xl` 26 (page title on phones), `text-title` 30 (page title from `lg`, Apple's "Large Title"). Never arbitrary `text-[Npx]`. `cn()` knows the custom steps (tailwind-merge is extended in `lib/utils.ts`); add any new step there too. Sizes above are at a 16px root. The root is 87.5% on desktop (≥1024px) and 100% on phones for **Standard** (the default, Apple-website density); **Larger** and **Largest** (`html[data-text-size]`, `lib/preferences.ts`) step it up by 12.5% each. So size in rem, never px. Font: **Inter**, bundled (`@fontsource-variable/inter`, imported in `main.tsx`), so it is identical on every device; never load a font from a CDN (the CSP is `'self'`). Weights: 400 body, 500 (`font-medium`) for controls and labels, `font-semibold` (580) for titles only; avoid `font-bold`. Headings get `letter-spacing: -0.02em` globally.

## Layout

Gutter `px-4` on mobile, `px-6` from `sm`. Content widths: auth `max-w-sm`, forms `max-w-xl`, case `max-w-2xl`, lists `max-w-5xl`. Radii: card `1.25rem`, control `0.75rem`, sheet/dialog `1.5rem`, buttons fully rounded. **Surfaces are flat**: cards are white with a hairline border and no shadow; only floating things (menus, dialogs, sheets, toasts) use `shadow-overlay`. Bars (sidebar, top bar, tab bar) use `bar-translucent`. Targets ≥44 px on every screen, not just mobile: button `sm` `min-h-11`, `md` `min-h-12`, `lg` `min-h-14`; inputs `min-h-12`. One global `:focus-visible` outline (3 px accent) — don't remove it with `outline-none`. Navigation: a left sidebar from `lg` (`app-shell.tsx`); below `lg` a slim top bar, plus a bottom tab bar only when there is more than one destination. Sign out lives only in the account menu. Page transitions ≤150 ms or none.

## Components and when to use which

| Need | Use |
|---|---|
| Form field with label + error | `Field` (wires `aria-invalid`, `aria-describedby`, error `role="alert"`) |
| Field-level validation error | inline under the field |
| Confirmation of a finished, non-blocking action | toast: success 8 s, error until dismissed; both have a Dismiss button |
| A way back from an inner page | `BackLink` ("← All cases"), plus `usePageTitle` on every page |
| Password field | `PasswordInput` (visible Show/Hide) |
| Text size | `TextSizeControl` (profile page) |
| A page-level load that failed | `ErrorState` with retry (inline) |
| Whole-screen state (404, 403, crash, pending approval) | `StatusPage` |
| A list that succeeded with zero rows | `EmptyState` (only then) |
| Irreversible action | `ConfirmDialog` (names the thing) |
| Secondary detail (files, case details) | `Sheet` (bottom on mobile, right on desktop) |
| Filters | `Tabs`, not hand-styled buttons |
| Upload | `Dropzone` (one shared component; not raw dashed buttons) |
| Any list of things (cases, people, payments, settings, details) | `List` + `ListRow` (inset grouped, like iOS Settings); `stack` on rows with pills so titles keep their width on phones |
| Signed-out screens | `AuthLayout` |
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
