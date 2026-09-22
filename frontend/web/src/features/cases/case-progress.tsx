import { cn } from '@/lib/utils'
import type { CaseStatus } from '@/types/api'

const STEPS: { label: string; statuses: CaseStatus[] }[] = [
  { label: 'Submitted', statuses: ['submitted'] },
  { label: 'In review', statuses: ['review_fee_paid'] },
  { label: 'Accepted', statuses: ['accepted'] },
  { label: 'Quoted', statuses: ['quoted'] },
  { label: 'Delivered', statuses: ['delivered', 'revision_requested'] },
  { label: 'Completed', statuses: ['completed'] },
]

// A compact sense of where the case is on its normal path. Not shown for a
// draft (not submitted yet) or a rejected case (off the path entirely).
export function CaseProgress({ status }: { status: CaseStatus }) {
  if (status === 'draft' || status === 'rejected') return null
  const currentIndex = STEPS.findIndex((step) => step.statuses.includes(status))

  return (
    <div aria-hidden className="mb-4 flex items-center gap-1.5">
      {STEPS.map((step, i) => (
        <div
          key={step.label}
          title={step.label}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            i <= currentIndex ? 'bg-[var(--color-accent)]' : 'bg-black/[0.08]',
          )}
        />
      ))}
    </div>
  )
}
