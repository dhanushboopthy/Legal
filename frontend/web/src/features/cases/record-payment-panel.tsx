import { useMutation, useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Input, Label } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast-context'
import { getQuote } from '@/lib/api/cases'
import { OFFLINE_METHOD_LABELS, recordOfflinePayment } from '@/lib/api/payments'
import { getErrorMessage } from '@/lib/errors'
import { cn, formatCurrency } from '@/lib/utils'
import type { OfflineMethod } from '@/types/api'

const METHODS = Object.keys(OFFLINE_METHOD_LABELS) as OfflineMethod[]

/** The advocate's card while the drafting charges are unpaid. The lawyer can
 * pay online, or pay the office directly (cash, GPay, a transfer, a cheque):
 * then the advocate records it here and the draft becomes available to the lawyer. */
export function RecordPaymentPanel({
  caseId,
  canRecord,
  canReplace,
  onReplace,
  onChanged,
}: {
  caseId: string
  canRecord: boolean
  canReplace: boolean
  onReplace: () => void
  onChanged: () => void
}) {
  const { toast } = useToast()
  const quote = useQuery({ queryKey: ['quote', caseId], queryFn: () => getQuote(caseId) })
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState<OfflineMethod | null>(null)
  const [reference, setReference] = useState('')

  const record = useMutation({
    mutationFn: () =>
      recordOfflinePayment(caseId, {
        method: method!,
        reference: reference.trim() || undefined,
      }),
    onSuccess: () => {
      toast({
        variant: 'success',
        title: 'Payment recorded',
        description: 'The draft is now available. The lawyer has been told and can download it.',
      })
      setOpen(false)
      onChanged()
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: 'Could not record the payment',
        description: getErrorMessage(err),
      }),
  })

  if (quote.isLoading) return <Skeleton className="h-40" />
  if (quote.error || !quote.data) {
    return (
      <ErrorState
        error={quote.error}
        title="Couldn't load the drafting charges"
        onRetry={() => void quote.refetch()}
      />
    )
  }

  const amount = formatCurrency(quote.data.amount_inr)

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="bg-ink/[0.04] hidden size-11 shrink-0 items-center justify-center rounded-full text-[var(--fg-muted)] sm:flex">
          <Clock className="size-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Waiting for the lawyer to pay {amount}</h3>
          <p className="text-muted mt-0.5 text-sm">
            They can pay online. If they pay you directly instead, record it here and the draft
            becomes available to them.
          </p>

          {!open ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {canRecord && (
                <Button onClick={() => setOpen(true)}>Record a payment received</Button>
              )}
              {canReplace && (
                <Button variant="secondary" onClick={onReplace}>
                  Replace draft or change charges
                </Button>
              )}
            </div>
          ) : (
            <fieldset className="mt-5 border-t border-[var(--border)] pt-5">
              <legend className="sr-only">Record a payment received</legend>
              <p id="record_method_label" className="font-medium">
                How was {amount} paid?
              </p>
              <div
                className="mt-3 flex flex-wrap gap-2"
                role="group"
                aria-labelledby="record_method_label"
              >
                {METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={method === m}
                    onClick={() => setMethod(m)}
                    className={cn(
                      'min-h-11 rounded-full px-4 text-sm font-medium transition-colors',
                      method === m
                        ? 'bg-navy text-white'
                        : 'bg-ink/[0.06] hover:bg-ink/[0.1] text-[var(--fg)]',
                    )}
                  >
                    {OFFLINE_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <Label htmlFor="record_reference">Reference (optional)</Label>
                <Input
                  id="record_reference"
                  value={reference}
                  maxLength={150}
                  onChange={(e) => setReference(e.target.value)}
                  aria-describedby="record_reference_hint"
                />
                <p id="record_reference_hint" className="text-muted text-label mt-1.5">
                  A UPI transaction ID, cheque number or receipt number, for your records.
                </p>
              </div>

              <p className="mt-4 text-sm">
                Only confirm once you have the money. The lawyer can download the draft straight
                away.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  loading={record.isPending}
                  disabled={method === null}
                  onClick={() => record.mutate()}
                >
                  Mark {amount} as received
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </fieldset>
          )}
        </div>
      </div>
    </Card>
  )
}
