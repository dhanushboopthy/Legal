import { useQuery } from '@tanstack/react-query'
import { ChevronDown, FolderOpen, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { PERMISSIONS } from '@/auth/permissions'
import { usePermissions } from '@/auth/use-permissions'
import { buttonVariants } from '@/components/ui/button-variants'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { List, ListRow } from '@/components/ui/list'
import { Skeleton } from '@/components/ui/skeleton'
import { CaseStatusPill } from '@/components/ui/status-pill'
import { usePageTitle } from '@/hooks/use-page-title'
import { listCases } from '@/lib/api/cases'
import { perspectiveFor, type Perspective } from '@/lib/status-meta'
import { shortTime } from '@/lib/time'
import type { CaseListItem } from '@/types/api'

// A lawyer rarely has enough cases to need search; it appears once they do.
const SEARCH_FROM = 8

export function DashboardPage() {
  usePageTitle('Cases')
  const { can } = usePermissions()
  const { user } = useAuth()
  const perspective = perspectiveFor(can)
  const viewsAll = can(PERMISSIONS.CASE_VIEW_ALL)
  const canSubmit = can(PERMISSIONS.CASE_SUBMIT)
  const [query, setQuery] = useState('')

  const {
    data: cases,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['cases'],
    queryFn: listCases,
    // Unread counts and last messages change without anyone opening the list; the
    // socket refreshes it at once when connected, this is the fallback.
    refetchInterval: 30_000,
  })
  const hasCases = (cases?.length ?? 0) > 0
  const showSearch = viewsAll || (cases?.length ?? 0) > SEARCH_FROM

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return cases ?? []
    return (cases ?? []).filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.junior_lawyer_name.toLowerCase().includes(q) ||
        c.case_number?.toLowerCase().includes(q),
    )
  }, [cases, query])

  const finished = matching.filter((c) => c.turn === 'none' && c.status !== 'held_over')

  // Grouped by whose turn it is; the groups replace filter buttons.
  const groups =
    perspective === 'reviewer'
      ? { you: 'Needs you', them: 'Waiting on the lawyer', none: 'Finished' }
      : { you: 'Your turn', them: 'With the advocate', none: 'Finished' }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="lg:text-title text-2xl font-semibold">Cases</h1>
          <p className="text-muted mt-1 text-sm">
            {viewsAll ? 'Every case filed with the practice.' : 'The cases you have filed.'}
          </p>
        </div>
        {/* One "New case" per screen: the empty state carries its own. */}
        {canSubmit && hasCases && (
          <Link to="/cases/new" className={buttonVariants()}>
            <Plus className="size-5" aria-hidden /> New case
          </Link>
        )}
      </div>

      {showSearch && hasCases && (
        <div className="relative mb-8">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-[var(--fg-muted)]"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              viewsAll ? 'Search by title, lawyer or case number' : 'Search by title or case number'
            }
            aria-label="Search cases"
            className="text-lead min-h-12 w-full rounded-[var(--radius-control)] border-0 bg-ink/[0.06] py-2 pr-4 pl-12 placeholder:text-[var(--fg-muted)] focus:bg-white focus:ring-1 focus:ring-[var(--border-strong)]"
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : error && !cases ? (
        <ErrorState
          error={error}
          title={viewsAll ? "Couldn't load cases" : "Couldn't load your cases"}
          onRetry={() => void refetch()}
        />
      ) : !hasCases ? (
        <EmptyState
          icon={FolderOpen}
          title="No cases yet"
          description={
            canSubmit
              ? 'Submit your first case to get started.'
              : 'Cases will appear here once lawyers submit them.'
          }
          action={
            canSubmit && (
              <Link to="/cases/new" className={buttonVariants()}>
                New case
              </Link>
            )
          }
        />
      ) : matching.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No cases match your search"
          description="Check the spelling, or search by case number."
        />
      ) : (
        <div className="space-y-8">
          <CaseGroup
            title={groups.you}
            cases={matching.filter((c) => c.turn === 'you')}
            perspective={perspective}
            ownId={user?.id}
          />
          <CaseGroup
            title={groups.them}
            cases={matching.filter((c) => c.turn === 'them')}
            perspective={perspective}
            ownId={user?.id}
          />
          {/* Paused by the advocate: nobody's move until it is resumed. */}
          <CaseGroup
            title="Held over"
            cases={matching.filter((c) => c.status === 'held_over')}
            perspective={perspective}
            ownId={user?.id}
          />
          <CaseGroup
            title={groups.none}
            cases={finished}
            perspective={perspective}
            ownId={user?.id}
            // Tucked away only when there is active work above it to look at.
            collapsible={!query && finished.length < matching.length}
          />
        </div>
      )}
    </div>
  )
}

function CaseGroup({
  title,
  cases,
  perspective,
  ownId,
  collapsible = false,
}: {
  title: string
  cases: CaseListItem[]
  perspective: Perspective
  ownId?: string
  collapsible?: boolean
}) {
  const [open, setOpen] = useState(!collapsible)
  if (cases.length === 0) return null

  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="text-accent-ink inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium hover:bg-[var(--color-accent)]/[0.08]"
      >
        <ChevronDown className="size-5" aria-hidden />
        Show {cases.length} finished {cases.length === 1 ? 'case' : 'cases'}
      </button>
    )
  }

  return (
    <List heading={`${title} (${cases.length})`}>
      {cases.map((c) => (
        <CaseRow key={c.id} c={c} perspective={perspective} ownId={ownId} />
      ))}
    </List>
  )
}

function CaseRow({
  c,
  perspective,
  ownId,
}: {
  c: CaseListItem
  perspective: Perspective
  ownId?: string
}) {
  const last = c.last_message
  const sender = last && (last.sender_id && last.sender_id === ownId ? 'You' : last.sender_name)
  const subtitle = (
    <>
      <span className="block">
        {[c.case_number, perspective === 'reviewer' ? c.junior_lawyer_name : c.case_type]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {last && (
        <span className={c.unread_count > 0 ? 'mt-0.5 block text-[var(--fg)]' : 'mt-0.5 block'}>
          <span className="line-clamp-1">
            {sender ? `${sender}: ` : ''}
            {last.preview}
          </span>
          <span className="text-caption">{shortTime(last.at)}</span>
        </span>
      )}
    </>
  )

  return (
    <ListRow
      to={`/cases/${c.id}`}
      stack
      title={<span className="line-clamp-2">{c.title}</span>}
      subtitle={subtitle}
      trailing={
        <>
          {c.unread_count > 0 && (
            <span
              aria-label={`${c.unread_count} unread ${c.unread_count === 1 ? 'message' : 'messages'}`}
              className="text-caption inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--color-accent)] px-2 py-0.5 font-semibold text-white"
            >
              {c.unread_count}
            </span>
          )}
          <CaseStatusPill status={c.status} perspective={perspective} />
        </>
      }
    />
  )
}
