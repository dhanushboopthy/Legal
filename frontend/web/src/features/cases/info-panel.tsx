import type { LucideIcon } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function InfoPanel({
  icon: Icon,
  title,
  description,
  tone = 'neutral',
}: {
  icon: LucideIcon
  title: string
  description: string
  tone?: 'neutral' | 'success' | 'danger'
}) {
  const toneClass = {
    neutral: 'bg-black/[0.04] text-[var(--fg-muted)] dark:bg-white/[0.06]',
    success: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
    danger: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
  }[tone]

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full',
            toneClass,
          )}
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </div>
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-muted mt-0.5 text-sm">{description}</p>
        </div>
      </div>
    </Card>
  )
}
