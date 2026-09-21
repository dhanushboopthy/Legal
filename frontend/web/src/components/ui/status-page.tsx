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
}: {
  icon: LucideIcon
  code?: string
  title: string
  description: string
  actions?: ReactNode
  inline?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 text-center',
        inline ? 'min-h-[60vh]' : 'min-h-screen',
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-black/[0.04]">
        <Icon className="size-7 text-[var(--fg-muted)]" strokeWidth={1.5} />
      </div>
      {code && <p className="text-muted text-[13px] font-medium tracking-widest">{code}</p>}
      <h1 className="-mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted max-w-sm text-sm">{description}</p>
      {actions && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </div>
  )
}
