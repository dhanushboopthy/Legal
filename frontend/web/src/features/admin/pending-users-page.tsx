import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast-context'
import { getErrorMessage } from '@/lib/errors'
import { approveUser, listPendingUsers } from '@/lib/api/users'

export function PendingUsersPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const {
    data: users,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['pending-users'],
    queryFn: listPendingUsers,
  })

  const approve = useMutation({
    mutationFn: approveUser,
    onSuccess: (user) => {
      toast({ variant: 'success', title: `${user.full_name} approved` })
      void queryClient.invalidateQueries({ queryKey: ['pending-users'] })
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: 'Could not approve user',
        description: getErrorMessage(err),
      }),
  })

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Pending lawyers</h1>
      <p className="text-muted mb-6 text-sm">Approve new junior lawyer registrations.</p>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : error && !users ? (
        <ErrorState
          error={error}
          title="Couldn't load pending lawyers"
          onRetry={() => void refetch()}
        />
      ) : !users || users.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title="No pending approvals"
          description="Every registration has been reviewed."
        />
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <Card key={u.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium">{u.full_name}</p>
                <p className="text-muted text-label">
                  {u.email}
                  {u.bar_council_id && ` · Bar council ID: ${u.bar_council_id}`}
                </p>
              </div>
              <Button
                size="sm"
                loading={approve.isPending && approve.variables === u.id}
                onClick={() => approve.mutate(u.id)}
              >
                Approve
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
