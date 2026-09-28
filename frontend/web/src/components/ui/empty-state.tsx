import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-ink/[0.04]">
        <Icon className="size-6 text-[var(--fg-muted)]" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="text-muted max-w-sm text-sm">{description}</p>}
      {action}
    </div>
  )
}
