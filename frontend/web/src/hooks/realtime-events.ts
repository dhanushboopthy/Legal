import type { QueryClient } from '@tanstack/react-query'

// What the server can push, and what each event makes stale. Events carry ids,
// not content: each one just says which cached queries are now out of date, and
// the normal (authorised) endpoints supply the data.

export interface ServerEvent {
  type: string
  case_id?: string
}

/** Mark what an event made stale. */
export function applyEvent(queryClient: QueryClient, event: ServerEvent): void {
  const invalidate = (...key: unknown[]) => void queryClient.invalidateQueries({ queryKey: key })
  const caseId = event.case_id
  switch (event.type) {
    case 'message.created':
      if (caseId) invalidate('thread', caseId)
      invalidate('cases')
      invalidate('notifications')
      break
    case 'read.updated':
      if (caseId) invalidate('thread', caseId)
      break
    case 'case.status_changed':
      invalidate('cases')
      if (caseId) {
        invalidate('case', caseId)
        invalidate('case-documents', caseId)
        invalidate('case-payments', caseId)
      }
      break
  }
}

const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export function reconnectDelay(attempt: number, random: number = Math.random()): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** attempt)
  return Math.round(base * (0.5 + random / 2)) // jitter, so a restart doesn't stampede
}
