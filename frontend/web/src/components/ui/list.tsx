import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

/** An inset grouped list, like iOS/macOS Settings: one white rounded group
 * with hairline dividers. Optional heading above and footnote below. */
export function List({
  heading,
  footnote,
  children,
  className,
}: {
  heading?: ReactNode
  footnote?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      {heading && <h2 className="text-muted mb-2 px-4 text-sm font-medium">{heading}</h2>}
      <ul className="surface shadow-card divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
        {children}
      </ul>
      {footnote && <p className="text-muted text-label mt-2 px-4">{footnote}</p>}
    </section>
  )
}

/** One row. With `to` the whole row is a link and gets a chevron. */
export function ListRow({
  to,
  onClick,
  icon: Icon,
  leading,
  title,
  subtitle,
  trailing,
  chevron = true,
  stack = false,
  className,
}: {
  to?: string
  onClick?: () => void
  icon?: LucideIcon
  /** In place of an icon, e.g. a person's picture. */
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  /** Off for rows whose trailing content already says what a tap does. */
  chevron?: boolean
  /** On small screens put the trailing content under the text, not beside it,
   * so long titles keep their width (for rows with pills and badges). */
  stack?: boolean
  className?: string
}) {
  const body = (
    <>
      {leading}
      {Icon && (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[0.625rem] bg-[var(--color-accent)]/10 text-[var(--color-accent-ink)]">
          <Icon className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
      )}
      <span
        className={cn(
          'flex min-w-0 flex-1 gap-2',
          stack ? 'flex-col sm:flex-row sm:items-center sm:gap-3' : 'items-center gap-3',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium break-words">{title}</span>
          {subtitle && <span className="text-muted text-label mt-0.5 block">{subtitle}</span>}
        </span>
        {trailing && (
          <span
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-2 text-sm break-words',
              stack
                ? 'sm:max-w-[45%] sm:justify-end sm:text-right'
                : 'max-w-[60%] justify-end text-right',
            )}
          >
            {trailing}
          </span>
        )}
      </span>
      {chevron && (to || onClick) && (
        <ChevronRight className="size-5 shrink-0 text-[var(--fg-muted)]" aria-hidden />
      )}
    </>
  )
  const rowClass = cn('flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left', className)
  const interactive = 'transition-colors hover:bg-ink/[0.03] active:bg-ink/[0.06]'

  return (
    <li>
      {to ? (
        <Link to={to} className={cn(rowClass, interactive)}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(rowClass, interactive)}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  )
}
