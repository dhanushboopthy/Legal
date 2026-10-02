import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { List, ListRow } from '@/components/ui/list'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PaymentStatusPill } from '@/components/ui/status-pill'
import { useToast } from '@/components/ui/toast-context'
import { getErrorMessage } from '@/lib/errors'
import { listAllPayments, OFFLINE_METHOD_LABELS, refundPayment } from '@/lib/api/payments'
import { PERMISSIONS } from '@/auth/permissions'
import { usePermissions } from '@/auth/use-permissions'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { PaymentListItem } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'
import { BackLink } from '@/components/layout/back-link'

export function PaymentsPage() {
  usePageTitle('Payments')
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<PaymentListItem | null>(null)
  const { can } = usePermissions()
  const offline = confirming?.gateway === 'offline'

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
    onSuccess: (payment) => {
      setConfirming(null)
      toast({
        variant: 'success',
        // An offline refund takes effect at once; Razorpay confirms its own later.
        title: payment.status === 'refunded' ? 'Marked as refunded' : 'Refund started',
      })
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
      <BackLink to="/">All cases</BackLink>
      <h1 className="lg:text-title text-2xl font-semibold">Payments</h1>
      <p className="text-muted mt-1 mb-8 text-sm">Every payment across the practice.</p>

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
        <List>
          {payments.map((p) => (
            <ListRow
              key={p.id}
              stack
              title={
                <Link to={`/cases/${p.case_id}`} className="text-accent-ink hover:underline">
                  {p.case_title}
                </Link>
              }
              subtitle={[
                p.case_number,
                p.junior_lawyer_name,
                p.type === 'review' ? 'Review fee' : 'Drafting charges',
                p.method && `Paid by ${OFFLINE_METHOD_LABELS[p.method]}`,
                p.reference && `Ref. ${p.reference}`,
                p.paid_at ? formatDate(p.paid_at) : 'Not paid',
              ]
                .filter(Boolean)
                .join(' · ')}
              trailing={
                <>
                  <span className="font-medium tabular-nums">{formatCurrency(p.amount)}</span>
                  <PaymentStatusPill status={p.status} />
                  {p.status === 'paid' && can(PERMISSIONS.PAYMENT_REFUND) && (
                    <Button size="sm" variant="secondary" onClick={() => setConfirming(p)}>
                      {p.gateway === 'offline' ? 'Mark as refunded' : 'Refund'}
                    </Button>
                  )}
                </>
              }
            />
          ))}
        </List>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={
          offline
            ? `Mark ${confirming ? formatCurrency(confirming.amount) : ''} as refunded to ${confirming?.junior_lawyer_name}?`
            : `Refund ${confirming ? formatCurrency(confirming.amount) : ''} to ${confirming?.junior_lawyer_name}?`
        }
        description={
          offline
            ? `For “${confirming?.case_title}”. Do this once you’ve given the money back, or if it was recorded by mistake. The draft locks again for the lawyer. This can’t be undone.`
            : `For “${confirming?.case_title}”. This can’t be undone.`
        }
        confirmLabel={offline ? 'Mark as refunded' : 'Refund'}
        tone="danger"
        loading={refund.isPending}
        onConfirm={() => confirming && refund.mutate(confirming.id)}
      />
    </div>
  )
}
