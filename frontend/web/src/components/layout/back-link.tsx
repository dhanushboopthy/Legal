import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

/** "← All cases": always a visible, labelled way back, not just the browser's. */
export function BackLink({ to, children, className }: { to: string; children: string; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'text-accent-ink -ml-2 mb-4 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm font-semibold hover:bg-black/[0.05] hover:underline',
        className,
      )}
    >
      <ArrowLeft className="size-5" aria-hidden />
      {children}
    </Link>
  )
}
