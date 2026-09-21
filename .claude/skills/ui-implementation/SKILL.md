---
name: ui-implementation
description: Checks to run and conventions to follow when implementing UI in frontend/web. Read before writing or finishing any frontend task.
---

> **Draft, review me.** Conventions observed in `frontend/web` plus the gates from `docs/UX_REDESIGN_PLAN.md` §6.

## After every task

Run from `frontend/web` and fix failures before the next task:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

For anything a user would see, also rebuild and smoke-test the container (`docker compose up -d --build web`, then load `http://localhost:3100`). If a check needs a real browser (visual layout, 360 px, focus order) and none is available, say **"not verified"** in the report instead of implying it passed. Format only the files you changed (`npx prettier --write <files>`).

## Conventions

- Path alias `@/` for `src/`. Features grouped by domain in `src/features/<domain>/`; shared UI in `src/components/ui/`; API functions in `src/lib/api/<router>.ts`; types in `src/types/api.ts` (hand-mirrored from `app/schemas`, keep in sync).
- Server state via TanStack Query; local UI state with `useState`; forms with react-hook-form + zod.
- The SPA never stores a token in `localStorage`. All API traffic goes through `apiClient` (`/api`), auth through the BFF (`/bff`).
- **Gate by permission**, `can('case:submit')` from `usePermissions()`, never `role_name`.
- Amounts and fees come from the server. Format money only with `formatCurrency`.
- Status labels/tones/next-step text come from `statusMeta`; don't switch on status in a component to pick text.
- API errors go through `getErrorMessage(err)`. No per-component `describeError`.
- Download links are an anchor click, not `window.open` after an `await`.
- Chat and any user text render as plain text; never `dangerouslySetInnerHTML`.

## States (every query-backed view)

| State | Requirement |
|---|---|
| Loading | Skeleton matching the final layout |
| Empty | Only when the request **succeeded** with zero rows; offer the next step |
| Error | `ErrorState` with retry and the server's message; never rendered as empty |
| Success | Visible confirmation for money and irreversible actions |

## Accessibility minimums

Every icon-only button has an accessible name (avatar, bell, close). Inputs use `Field`. Errors are `role="alert"`. Focus is trapped in dialogs/sheets and returns on close. Text ≥ 4.5:1 (use `-ink` tokens on tints). Touch targets ≥ 44 px on mobile. Respect `prefers-reduced-motion`.

## Tests

Colocate as `*.test.ts(x)` and run with Vitest + Testing Library. Vitest globals are **not** enabled, so call `cleanup()` in `afterEach` when a file renders more than once. Mock HTTP with `axios-mock-adapter` on `apiClient`. Test the failure path (error not shown as empty), not just the happy path.

## Report format

End each task batch with: what changed, which findings are resolved, what you could not verify, and any decision needed from the owner.
