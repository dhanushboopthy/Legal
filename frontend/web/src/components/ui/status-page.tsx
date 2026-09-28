import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// Shared layout for full-page states (404, 403, crashes, pending approval).
// `inline` renders inside the app shell's content area instead of taking over
// the whole viewport.
export function StatusPage({
  icon: Icon,
  code,
  title,
  description,
  actions,
  inline = false,
  compact = false,
}: {
  icon: LucideIcon
  code?: string
  title: string
  description: string
  actions?: ReactNode
  inline?: boolean
  // A block inside a page (a failed list), not a whole-page state.
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 text-center',
        compact ? 'py-16' : inline ? 'min-h-[60vh]' : 'min-h-screen',
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-ink/[0.04]">
        <Icon className="size-7 text-[var(--fg-muted)]" strokeWidth={1.5} />
      </div>
      {code && <p className="text-muted text-label font-medium tracking-widest">{code}</p>}
      <h1 className="-mt-2 text-2xl font-semibold">{title}</h1>
      <p className="text-muted max-w-sm text-sm">{description}</p>
      {actions && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </div>
  )
}
