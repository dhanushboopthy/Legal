import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function InfoPanel({
  icon: Icon,
  title,
  description,
  tone = 'neutral',
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  tone?: 'neutral' | 'success' | 'danger'
  // The one thing to do next, when there is one.
  action?: ReactNode
}) {
  const toneClass = {
    neutral: 'bg-ink/[0.04] text-[var(--fg-muted)]',
    success: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
    danger: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
  }[tone]

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'hidden size-11 shrink-0 items-center justify-center rounded-full sm:flex',
            toneClass,
          )}
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </div>
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-muted mt-0.5 text-sm">{description}</p>
          {action}
        </div>
      </div>
    </Card>
  )
}
