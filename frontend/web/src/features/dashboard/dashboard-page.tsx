import { useQuery } from '@tanstack/react-query'
import { FolderOpen, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { CaseStatusPill } from '@/components/ui/status-pill'
import { listCases } from '@/lib/api/cases'
import { formatDate } from '@/lib/utils'
import type { CaseStatus } from '@/types/api'

const FILTERS: Array<{ label: string; statuses: CaseStatus[] | null }> = [
  { label: 'All', statuses: null },
  {
    label: 'Active',
    statuses: [
      'submitted',
      'review_fee_paid',
      'under_review',
      'accepted',
      'drafting_fee_paid',
      'drafting',
      'draft_delivered',
      'revision_requested',
    ],
  },
  { label: 'Completed', statuses: ['completed', 'approved'] },
  { label: 'Rejected', statuses: ['rejected'] },
]

export function DashboardPage() {
  const { user } = useAuth()
  const isAdmin = user?.role_name === 'super_admin'
  const [filterIndex, setFilterIndex] = useState(0)

  const { data: cases, isLoading } = useQuery({ queryKey: ['cases'], queryFn: listCases })

  const filtered = useMemo(() => {
    const statuses = FILTERS[filterIndex]?.statuses
    if (!cases) return []
    if (!statuses) return cases
    return cases.filter((c) => statuses.includes(c.status))
  }, [cases, filterIndex])

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isAdmin ? 'All cases' : 'My cases'}
          </h1>
          <p className="text-muted mt-1 text-sm">
            {isAdmin
              ? 'Every case submitted across the practice.'
              : 'Track the cases you have submitted for filing.'}
          </p>
        </div>
        {!isAdmin && (
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
              'rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ' +
              (i === filterIndex
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-black/[0.04] text-[var(--fg-muted)] hover:bg-black/[0.07] dark:bg-white/[0.06] dark:hover:bg-white/[0.1]')
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
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No cases yet"
          description={
            isAdmin ? 'No cases match this filter.' : 'Submit your first case to get started.'
          }
          action={
            !isAdmin && (
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
                  <p className="text-muted mt-0.5 text-[13px]">
                    {c.case_type} &middot; Submitted {formatDate(c.created_at)}
                  </p>
                </div>
                <CaseStatusPill status={c.status} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
