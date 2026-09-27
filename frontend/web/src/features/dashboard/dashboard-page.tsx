import { useQuery } from '@tanstack/react-query'
import { FolderOpen, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { PERMISSIONS } from '@/auth/permissions'
import { usePermissions } from '@/auth/use-permissions'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { CaseStatusPill } from '@/components/ui/status-pill'
import { listCases } from '@/lib/api/cases'
import { STATUS_META, perspectiveFor, type StatusGroup } from '@/lib/status-meta'
import { formatDate } from '@/lib/utils'
import type { CaseListItem } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'

const FILTERS: Array<{ label: string; group: StatusGroup | null }> = [
  { label: 'All', group: null },
  { label: 'Active', group: 'active' },
  { label: 'Completed', group: 'completed' },
  { label: 'Rejected', group: 'rejected' },
]

export function DashboardPage() {
  usePageTitle('Cases')
  const { can } = usePermissions()
  const perspective = perspectiveFor(can)
  const viewsAll = can(PERMISSIONS.CASE_VIEW_ALL)
  const canSubmit = can(PERMISSIONS.CASE_SUBMIT)
  const [filterIndex, setFilterIndex] = useState(0)
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

  const filtered = useMemo(() => {
    const group = FILTERS[filterIndex]?.group
    let list = cases ?? []
    if (group) list = list.filter((c) => STATUS_META[c.status].group === group)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.junior_lawyer_name.toLowerCase().includes(q) ||
          c.case_number?.toLowerCase().includes(q),
      )
    }
    return list
  }, [cases, filterIndex, query])

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {viewsAll ? 'All cases' : 'My cases'}
          </h1>
          <p className="text-muted mt-1 text-sm">
            {viewsAll
              ? 'Every case submitted across the practice.'
              : 'Track the cases you have submitted for filing.'}
          </p>
        </div>
        {canSubmit && (
          <Link to="/cases/new" className={buttonVariants({ variant: 'primary', size: 'md' })}>
            <Plus className="size-4" /> New case
          </Link>
        )}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {FILTERS.map((f, i) => (
            <button
              key={f.label}
              onClick={() => setFilterIndex(i)}
              className={
                'text-label rounded-full px-3.5 py-1.5 font-medium transition-colors ' +
                (i === filterIndex
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-black/[0.04] text-[var(--fg-muted)] hover:bg-black/[0.07]')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        {viewsAll && (
          <div className="relative min-w-48 flex-1 sm:flex-none">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--fg-muted)]"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, lawyer or case number"
              aria-label="Search cases"
              className="w-full rounded-full border border-[var(--border)] surface py-1.5 pr-3 pl-9 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/40"
            />
          </div>
        )}
      </div>

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
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={hasCases ? 'Nothing in this filter' : 'No cases yet'}
          description={
            hasCases
              ? 'Try another filter, or clear the search.'
              : canSubmit
                ? 'Submit your first case to get started.'
                : 'Cases will appear here once lawyers submit them.'
          }
          action={
            !hasCases &&
            canSubmit && (
              <Link to="/cases/new" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                New case
              </Link>
            )
          }
        />
      ) : viewsAll ? (
        <AdvocateInbox cases={filtered} perspective={perspective} />
      ) : (
        <CaseList cases={filtered} perspective={perspective} showLawyer={false} />
      )}
    </div>
  )
}

function AdvocateInbox({
  cases,
  perspective,
}: {
  cases: CaseListItem[]
  perspective: ReturnType<typeof perspectiveFor>
}) {
  const needsYou = cases.filter((c) => c.turn === 'you')
  const waitingOnLawyer = cases.filter((c) => c.turn === 'them')
  const done = cases.filter((c) => c.turn === 'none')

  return (
    <div className="space-y-8">
      <CaseGroup title="Needs you" cases={needsYou} perspective={perspective} />
      <CaseGroup title="Waiting on lawyer" cases={waitingOnLawyer} perspective={perspective} />
      <CaseGroup title="Done" cases={done} perspective={perspective} />
    </div>
  )
}

function CaseGroup({
  title,
  cases,
  perspective,
}: {
  title: string
  cases: CaseListItem[]
  perspective: ReturnType<typeof perspectiveFor>
}) {
  if (cases.length === 0) return null
  return (
    <div>
      <h2 className="text-muted text-label mb-2.5 font-semibold tracking-wide uppercase">
        {title} <span className="font-normal normal-case">({cases.length})</span>
      </h2>
      <CaseList cases={cases} perspective={perspective} showLawyer />
    </div>
  )
}

function CaseList({
  cases,
  perspective,
  showLawyer,
}: {
  cases: CaseListItem[]
  perspective: ReturnType<typeof perspectiveFor>
  showLawyer: boolean
}) {
  return (
    <div className="space-y-3">
      {cases.map((c) => (
        <Link key={c.id} to={`/cases/${c.id}`}>
          <Card className="flex items-center justify-between gap-4 transition-transform hover:-translate-y-0.5">
            <div className="min-w-0">
              {c.case_number && (
                <p className="text-muted text-caption font-medium">{c.case_number}</p>
              )}
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{c.title}</p>
                {c.turn === 'you' && (
                  <span className="text-caption inline-flex shrink-0 items-center rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 font-medium text-[var(--color-accent-ink)]">
                    Your turn
                  </span>
                )}
              </div>
              {showLawyer && (
                <p className="text-muted text-caption mt-0.5 truncate">
                  {c.junior_lawyer_name}
                  {c.junior_lawyer_bar_council_id && ` · Bar council ID: ${c.junior_lawyer_bar_council_id}`}
                </p>
              )}
              {c.last_message ? (
                <p
                  className={
                    c.unread_count > 0
                      ? 'text-label mt-0.5 truncate font-medium'
                      : 'text-muted text-label mt-0.5 truncate'
                  }
                >
                  {c.last_message.sender_name ? `${c.last_message.sender_name}: ` : ''}
                  {c.last_message.preview}
                </p>
              ) : (
                <p className="text-muted text-label mt-0.5">
                  {c.case_type} &middot; {c.status === 'draft' ? 'Started' : 'Submitted'}{' '}
                  {formatDate(c.created_at)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {c.unread_count > 0 && (
                <span
                  aria-label={`${c.unread_count} unread ${c.unread_count === 1 ? 'message' : 'messages'}`}
                  className="text-caption inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--color-accent)] px-2 py-0.5 font-medium text-white"
                >
                  {c.unread_count}
                </span>
              )}
              <CaseStatusPill status={c.status} perspective={perspective} />
            </div>
          </Card>
        </Link>
      ))}
    </div>
  )
}
