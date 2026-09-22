import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PaymentActionCard } from '@/features/cases/review-payment-panel'
import { getQuote, payQuote } from '@/lib/api/cases'
import { formatBytes } from '@/lib/uploads'
import { formatDate } from '@/lib/utils'
import type { DocumentOut } from '@/types/api'

// The locked draft card (docs/NEW_FLOW_SPEC.md): what the lawyer sees before
// paying — the file's name, size and page count, when it was sent, and
// whatever the advocate noted, but never the file itself.
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

  if (quote.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-20" />
      </div>
    )
  }
  if (quote.error || !quote.data) {
    return (
      <ErrorState
        error={quote.error}
        title="Couldn't load the quote"
        onRetry={() => void quote.refetch()}
      />
    )
  }

  const draft = documents.find((d) => d.id === quote.data.draft_document_id)

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-[var(--fg-muted)]">
            <Lock className="size-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{draft?.original_filename ?? 'Draft'}</p>
            <p className="text-muted text-label mt-0.5">
              {draft?.page_count != null && `${draft.page_count} pages · `}
              {draft?.size_bytes != null && `${formatBytes(draft.size_bytes)} · `}
              sent {formatDate(quote.data.created_at)}
            </p>
            {quote.data.note && (
              <p className="mt-3 border-t border-[var(--border)] pt-3 text-sm whitespace-pre-wrap">
                {quote.data.note}
              </p>
            )}
          </div>
        </div>
      </Card>

      <PaymentActionCard
        createOrder={() => payQuote(caseId)}
        title="Pay to unlock the draft"
        description="Pay the quoted amount to download this draft."
        amountInr={quote.data.amount_inr}
        onPaid={onChanged}
      />
    </div>
  )
}
