import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Users } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { List, ListRow } from '@/components/ui/list'
import { UserAvatar } from '@/components/ui/user-avatar'
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
      <h1 className="lg:text-title text-2xl font-semibold">People</h1>
      <p className="text-muted mt-1 mb-8 text-sm">
        Everyone at the practice, and new registrations to approve.
      </p>

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
            <List heading={`Waiting for approval (${pending.length})`}>
              {pending.map((u) => {
                const hours = hoursWaiting(u.created_at)
                const overdue = hours >= OVERDUE_AFTER_HOURS
                return (
                  <ListRow
                    key={u.id}
                    stack
                    leading={
                      <UserAvatar name={u.full_name} src={u.avatar_url} className="size-10" />
                    }
                    title={u.full_name}
                    subtitle={
                      <>
                        <PersonDetails user={u} />
                        <span
                          className={
                            overdue
                              ? 'text-warning-ink mt-0.5 flex items-center gap-1 font-medium'
                              : 'mt-0.5 block'
                          }
                        >
                          {overdue && <AlertTriangle className="size-4" aria-hidden />}
                          {waitingLabel(hours)}
                        </span>
                      </>
                    }
                    trailing={
                      <Button size="sm" onClick={() => setConfirming(u)}>
                        Approve
                      </Button>
                    }
                  />
                )
              })}
            </List>
          )}

          <List heading={`Active (${active.length})`}>
            {active.map((u) => (
              <ListRow
                key={u.id}
                leading={<UserAvatar name={u.full_name} src={u.avatar_url} className="size-10" />}
                title={u.full_name}
                subtitle={<PersonDetails user={u} />}
              />
            ))}
          </List>
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

// Display only, never used to decide what someone may do.
const ROLE_LABELS: Record<string, string> = {
  junior_lawyer: 'Lawyer',
  super_admin: 'Advocate',
  clerk: 'Clerk',
  accountant: 'Accountant',
}

function PersonDetails({ user }: { user: UserOut }) {
  return (
    <span className="block break-words">
      {[
        user.email,
        ROLE_LABELS[user.role_name] ?? user.role_name.replace(/_/g, ' '),
        user.bar_council_id && `Bar Council no. ${user.bar_council_id}`,
      ]
        .filter(Boolean)
        .join(' · ')}
    </span>
  )
}
