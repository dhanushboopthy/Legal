import { useQuery } from '@tanstack/react-query'
import { FolderOpen, Plus } from 'lucide-react'
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

const FILTERS: Array<{ label: string; group: StatusGroup | null }> = [
  { label: 'All', group: null },
  { label: 'Active', group: 'active' },
  { label: 'Completed', group: 'completed' },
  { label: 'Rejected', group: 'rejected' },
]

export function DashboardPage() {
  const { can } = usePermissions()
  const perspective = perspectiveFor(can)
  const viewsAll = can(PERMISSIONS.CASE_VIEW_ALL)
  const canSubmit = can(PERMISSIONS.CASE_SUBMIT)
  const [filterIndex, setFilterIndex] = useState(0)

  const {
    data: cases,
    isLoading,
    error,
    refetch,
  } = useQuery({ queryKey: ['cases'], queryFn: listCases })
  const hasCases = (cases?.length ?? 0) > 0

  const filtered = useMemo(() => {
    const group = FILTERS[filterIndex]?.group
    if (!cases) return []
    if (!group) return cases
    return cases.filter((c) => STATUS_META[c.status].group === group)
  }, [cases, filterIndex])

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

      <div className="mb-5 flex gap-1.5">
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
              ? 'Try another filter.'
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
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <Link key={c.id} to={`/cases/${c.id}`}>
              <Card className="flex items-center justify-between gap-4 transition-transform hover:-translate-y-0.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.title}</p>
                  <p className="text-muted text-label mt-0.5">
                    {c.case_type} &middot; Submitted {formatDate(c.created_at)}
                  </p>
                </div>
                <CaseStatusPill status={c.status} perspective={perspective} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
