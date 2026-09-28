import { PERMISSIONS, type CanFn } from '@/auth/permissions'
import type { CaseStatus } from '@/types/api'

// The statuses in which a case has a chat (docs/NEW_FLOW_SPEC.md D4).
export const CHAT_STATUSES: CaseStatus[] = [
  'accepted',
  'quoted',
  'delivered',
  'revision_requested',
  'completed',
  'held_over',
]

// Mirrors message_service.is_participant: the case's owner and whoever holds
// case:message — never everyone who can merely see the case. The server
// enforces this; the UI only uses it to decide what to show.
export function hasChat(
  c: { status: CaseStatus; junior_lawyer_id: string },
  userId: string | undefined,
  can: CanFn,
): boolean {
  if (!userId || !CHAT_STATUSES.includes(c.status)) return false
  return c.junior_lawyer_id === userId || can(PERMISSIONS.CASE_MESSAGE)
}
