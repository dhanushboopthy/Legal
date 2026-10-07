import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'

import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PaymentActionCard } from '@/features/cases/review-payment-panel'
import { getQuote, payQuote } from '@/lib/api/cases'
import { listPaymentsForCase } from '@/lib/api/payments'
import { formatBytes } from '@/lib/uploads'
import { formatDate } from '@/lib/utils'
import type { DocumentOut } from '@/types/api'

// One card (docs/NEW_FLOW_SPEC.md): what the draft is — name, size, pages,
// when it was sent, the advocate's note, never the file itself — and the one
// button that unlocks it, with the price on it.
export function QuotedPaymentPanel({
  caseId,
  documents,
  onChanged,
}: {
  caseId: string
  documents: DocumentOut[]
  onChanged: () => void
}) {
  const quote = useQuery({ queryKey: ['quote', caseId], queryFn: () => getQuote(caseId) })

  if (quote.isLoading) return <Skeleton className="h-48" />
  if (quote.error || !quote.data) {
    return (
      <ErrorState
        error={quote.error}
        title="Couldn't load the price"
        onRetry={() => void quote.refetch()}
      />
    )
  }

  const draft = documents.find((d) => d.id === quote.data.draft_document_id)
  const meta = [
    draft?.page_count != null ? `${draft.page_count} pages` : null,
    draft?.size_bytes != null ? formatBytes(draft.size_bytes) : null,
    `sent ${formatDate(quote.data.created_at)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <PaymentActionCard
      createOrder={() => payQuote(caseId)}
      title="Your draft is ready"
      description="Pay the price below to open and download it."
      amountInr={quote.data.amount_inr}
      buttonLabel={(amount) => `Pay ${amount} to download`}
      findPaymentId={async () =>
        (await listPaymentsForCase(caseId)).findLast(
          (p) => p.type === 'quote' && p.status === 'pending',
        )?.id
      }
      onPaid={onChanged}
    >
      <div className="bg-ink/[0.04] mt-4 rounded-[var(--radius-control)] p-4">
        <div className="flex items-start gap-3">
          <Lock
            className="mt-0.5 size-5 shrink-0 text-[var(--fg-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="font-medium break-words">{draft?.original_filename ?? 'Draft'}</p>
            <p className="text-muted text-label mt-0.5">{meta}</p>
          </div>
        </div>
        {quote.data.note && (
          <p className="mt-3 border-t border-[var(--border)] pt-3 text-sm whitespace-pre-wrap">
            {quote.data.note}
          </p>
        )}
      </div>
      <p className="text-muted mt-4 text-sm">
        Paying the office in cash or by GPay instead? Once they confirm receipt, the draft is available here.
      </p>
    </PaymentActionCard>
  )
}
