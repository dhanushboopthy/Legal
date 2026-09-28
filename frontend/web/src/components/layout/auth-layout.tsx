import { Scale, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { TextSizeControl } from '@/components/ui/text-size-control'

/** The one frame every signed-out screen shares: app mark, a large title, a
 * line of explanation, the form in a card, and a footer link. */
export function AuthLayout({
  title,
  subtitle,
  icon: Icon = Scale,
  children,
  footer,
}: {
  title: string
  subtitle?: ReactNode
  icon?: LucideIcon
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-[1rem] bg-[var(--fg)] text-white">
            <Icon className="size-7" strokeWidth={1.5} aria-hidden />
          </div>
          <div>
            <h1 className="lg:text-title text-2xl font-semibold">{title}</h1>
            {subtitle && <p className="text-muted mt-2 text-sm">{subtitle}</p>}
          </div>
        </div>
        <div className="surface rounded-[var(--radius-sheet)] border border-[var(--border)] p-6 sm:p-8">
          {children}
        </div>
        {footer && <div className="mt-6 text-center text-sm">{footer}</div>}
        {/* Before signing in, so anyone who needs bigger text can have it at once. */}
        <TextSizeControl compact className="mt-8" />
      </div>
    </main>
  )
}
