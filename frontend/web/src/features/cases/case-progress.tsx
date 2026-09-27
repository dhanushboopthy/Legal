import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { CaseStatus } from '@/types/api'

const STEPS: { label: string; statuses: CaseStatus[] }[] = [
  { label: 'Submitted', statuses: ['submitted'] },
  { label: 'Being reviewed', statuses: ['review_fee_paid'] },
  { label: 'Accepted', statuses: ['accepted'] },
  { label: 'Draft and price sent', statuses: ['quoted'] },
  { label: 'Draft paid for', statuses: ['delivered', 'revision_requested'] },
  { label: 'Complete', statuses: ['completed'] },
]

// Where the case is on its normal path, in words as well as a bar: "Step 3 of
// 6: Accepted". Not shown for a draft (not submitted yet) or a rejected case
// (off the path entirely).
export function CaseProgress({ status }: { status: CaseStatus }) {
  if (status === 'draft' || status === 'rejected') return null
  const currentIndex = STEPS.findIndex((step) => step.statuses.includes(status))
  const current = STEPS[currentIndex]

  return (
    <div className="mb-5">
      <p className="mb-2 text-sm">
        <span className="font-semibold">
          Step {currentIndex + 1} of {STEPS.length}:
        </span>{' '}
        {current?.label}
      </p>
      <ol aria-label="Case progress" className="grid grid-cols-6 gap-1.5">
        {STEPS.map((step, i) => {
          const done = i < currentIndex
          const isCurrent = i === currentIndex
          return (
            <li key={step.label} aria-current={isCurrent ? 'step' : undefined}>
              <div
                className={cn(
                  'h-2 rounded-full',
                  i <= currentIndex ? 'bg-[var(--color-accent)]' : 'bg-black/[0.12]',
                )}
              />
              <span
                className={cn(
                  'text-caption mt-1.5 hidden items-start gap-1 leading-tight sm:flex',
                  isCurrent ? 'font-bold text-[var(--fg)]' : 'text-muted',
                )}
              >
                {done && <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
                {step.label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
              <span className="sr-only sm:hidden">
                {step.label}
                {done ? ' (done)' : isCurrent ? ' (current)' : ''}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
