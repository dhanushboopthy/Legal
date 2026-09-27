import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Users } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast-context'
import { getErrorMessage } from '@/lib/errors'
import { approveUser, listUsers } from '@/lib/api/users'
import type { UserOut } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'
import { BackLink } from '@/components/layout/back-link'

// Matches the backend's default PENDING_APPROVAL_REMINDER_AFTER_HOURS — only
// used here to decide when to flag a row, not to gate anything.
const OVERDUE_AFTER_HOURS = 48

function hoursWaiting(createdAt: string): number {
  return (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
}

function waitingLabel(hours: number): string {
  const days = Math.floor(hours / 24)
  if (days < 1) return 'Waiting less than a day'
  return `Waiting ${days} ${days === 1 ? 'day' : 'days'}`
}

export function PeoplePage() {
  usePageTitle('People')
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<UserOut | null>(null)

  const {
    data: users,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  })

  const approve = useMutation({
    mutationFn: approveUser,
    onSuccess: (user) => {
      setConfirming(null)
      toast({ variant: 'success', title: `${user.full_name} approved` })
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: 'Could not approve user',
        description: getErrorMessage(err),
      }),
  })

  const pending = users?.filter((u) => !u.is_active) ?? []
  const active = users?.filter((u) => u.is_active) ?? []

  return (
    <div>
      <BackLink to="/">All cases</BackLink>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">People</h1>
      <p className="text-muted mb-6 text-sm">Everyone at the practice, and new registrations to approve.</p>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : error && !users ? (
        <ErrorState error={error} title="Couldn't load people" onRetry={() => void refetch()} />
      ) : !users || users.length === 0 ? (
        <EmptyState icon={Users} title="No one here yet" />
      ) : (
        <div className="space-y-8">
          {pending.length > 0 && (
            <section>
              <h2 className="text-muted text-label mb-2.5 font-semibold tracking-wide uppercase">
                Pending approval ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map((u) => {
                  const hours = hoursWaiting(u.created_at)
                  const overdue = hours >= OVERDUE_AFTER_HOURS
                  return (
                    <Card key={u.id} className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <PersonInfo user={u} />
                        <p
                          className={
                            overdue
                              ? 'text-warning-ink text-caption mt-1 flex items-center gap-1 font-medium'
                              : 'text-muted text-caption mt-1'
                          }
                        >
                          {overdue && <AlertTriangle className="size-3" aria-hidden />}
                          {waitingLabel(hours)}
                        </p>
                      </div>
                      <Button size="sm" className="shrink-0" onClick={() => setConfirming(u)}>
                        Approve
                      </Button>
                    </Card>
                  )
                })}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-muted text-label mb-2.5 font-semibold tracking-wide uppercase">
              Active ({active.length})
            </h2>
            <div className="space-y-3">
              {active.map((u) => (
                <Card key={u.id} className="flex items-center justify-between">
                  <PersonInfo user={u} />
                </Card>
              ))}
            </div>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Approve ${confirming?.full_name}?`}
        description="They'll be able to sign in and submit cases right away."
        confirmLabel="Approve"
        loading={approve.isPending}
        onConfirm={() => confirming && approve.mutate(confirming.id)}
      />
    </div>
  )
}

function PersonInfo({ user }: { user: UserOut }) {
  return (
    <div className="min-w-0">
      <p className="font-medium">{user.full_name}</p>
      <p className="text-muted text-label truncate">
        {user.email}
        {' · '}
        <span className="capitalize">{user.role_name.replace(/_/g, ' ')}</span>
        {user.bar_council_id && ` · Bar Council no. ${user.bar_council_id}`}
      </p>
    </div>
  )
}
