import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PaymentStatusPill } from '@/components/ui/status-pill'
import { useToast } from '@/components/ui/toast-context'
import { getErrorMessage } from '@/lib/errors'
import { listAllPayments, refundPayment } from '@/lib/api/payments'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { PaymentListItem } from '@/types/api'

export function PaymentsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<PaymentListItem | null>(null)

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
      setConfirming(null)
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
                <th className="px-4 py-3 font-medium">Case</th>
                <th className="px-4 py-3 font-medium">Lawyer</th>
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
                  <td className="max-w-48 truncate px-4 py-3">
                    <Link to={`/cases/${p.case_id}`} className="text-accent-ink hover:underline">
                      {p.case_title}
                    </Link>
                  </td>
                  <td className="text-muted px-4 py-3">{p.junior_lawyer_name}</td>
                  <td className="px-4 py-3 capitalize">{p.type} fee</td>
                  <td className="px-4 py-3">{formatCurrency(p.amount)}</td>
                  <td className="px-4 py-3">
                    <PaymentStatusPill status={p.status} />
                  </td>
                  <td className="text-muted px-4 py-3">
                    {p.paid_at ? formatDate(p.paid_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.status === 'paid' && (
                      <Button size="sm" variant="secondary" onClick={() => setConfirming(p)}>
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

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Refund ${confirming ? formatCurrency(confirming.amount) : ''} to ${confirming?.junior_lawyer_name}?`}
        description={`For "${confirming?.case_title}". This can't be undone.`}
        confirmLabel="Refund"
        tone="danger"
        loading={refund.isPending}
        onConfirm={() => confirming && refund.mutate(confirming.id)}
      />
    </div>
  )
}
