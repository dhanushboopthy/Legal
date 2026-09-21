import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PaymentStatusPill } from '@/components/ui/status-pill'
import { useToast } from '@/components/ui/toast-context'
import { getErrorMessage } from '@/lib/errors'
import { listAllPayments, refundPayment } from '@/lib/api/payments'
import { formatCurrency, formatDate } from '@/lib/utils'

export function PaymentsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const {
    data: payments,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['all-payments'],
    queryFn: listAllPayments,
  })

  const refund = useMutation({
    mutationFn: refundPayment,
    onSuccess: () => {
      toast({ variant: 'success', title: 'Refund initiated' })
      void queryClient.invalidateQueries({ queryKey: ['all-payments'] })
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: 'Could not initiate refund',
        description: getErrorMessage(err),
      }),
  })

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Payments</h1>
      <p className="text-muted mb-6 text-sm">Every payment across the practice.</p>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : error && !payments ? (
        <ErrorState error={error} title="Couldn't load payments" onRetry={() => void refetch()} />
      ) : !payments || payments.length === 0 ? (
        <EmptyState icon={Receipt} title="No payments yet" />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-label border-b border-[var(--border)] text-left">
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Paid at</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3 capitalize">{p.type}</td>
                  <td className="px-4 py-3">{formatCurrency(p.amount)}</td>
                  <td className="px-4 py-3">
                    <PaymentStatusPill status={p.status} />
                  </td>
                  <td className="text-muted px-4 py-3">
                    {p.paid_at ? formatDate(p.paid_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.status === 'paid' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={refund.isPending && refund.variables === p.id}
                        onClick={() => refund.mutate(p.id)}
                      >
                        Refund
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
