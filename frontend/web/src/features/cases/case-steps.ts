import type { CaseStatus } from '@/types/api'

const STEPS: { label: string; statuses: CaseStatus[] }[] = [
  { label: 'Submitted', statuses: ['submitted'] },
  { label: 'Being reviewed', statuses: ['review_fee_paid'] },
  { label: 'Accepted', statuses: ['accepted'] },
  { label: 'Draft and price sent', statuses: ['quoted'] },
  { label: 'Draft paid for', statuses: ['delivered', 'revision_requested'] },
  { label: 'Complete', statuses: ['completed'] },
]

/** "Step 3 of 6 · Accepted", or null off the normal path (draft, rejected). */
export function stepLine(status: CaseStatus): string | null {
  const i = STEPS.findIndex((s) => s.statuses.includes(status))
  if (i < 0) return null
  return `Step ${i + 1} of ${STEPS.length} · ${STEPS[i]!.label}`
}
