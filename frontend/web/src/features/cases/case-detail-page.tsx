import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Clock,
  ExternalLink,
  FolderOpen,
  Hourglass,
  Info,
  Pencil,
  PenSquare,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { isAxiosError } from 'axios'
import { Link, useLocation, useParams } from 'react-router-dom'

import { PERMISSIONS, type CanFn } from '@/auth/permissions'
import { useAuth } from '@/auth/auth-context'
import { usePermissions } from '@/auth/use-permissions'
import { BackLink } from '@/components/layout/back-link'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CaseStatusPill } from '@/components/ui/status-pill'
import { useToast } from '@/components/ui/toast-context'
import { ForbiddenPage } from '@/features/errors/forbidden-page'
import { NotFoundPage } from '@/features/errors/not-found-page'
import { ServerErrorPage } from '@/features/errors/server-error-page'
import { hasChat } from '@/features/chat/chat-access'
import { ChatThread } from '@/features/chat/chat-thread'
import { CaseProgress } from '@/features/cases/case-progress'
import { DecisionPanel } from '@/features/cases/decision-panel'
import { DetailsSheet } from '@/features/cases/details-sheet'
import { DraftReviewPanel } from '@/features/cases/draft-review-panel'
import { FilesSheet } from '@/features/cases/files-sheet'
import { InfoPanel } from '@/features/cases/info-panel'
import { QuotedPaymentPanel } from '@/features/cases/quoted-payment-panel'
import { QuoteSheet } from '@/features/cases/quote-sheet'
import { PaymentActionCard } from '@/features/cases/review-payment-panel'
import { UploadRevisionPanel } from '@/features/cases/upload-revision-panel'
import { createReviewPayment, getCase } from '@/lib/api/cases'
import { getPricing } from '@/lib/api/config'
import { usePageTitle } from '@/hooks/use-page-title'
import { listCaseDocuments } from '@/lib/api/documents'
import { listPaymentsForCase } from '@/lib/api/payments'
import { getStatusMeta, perspectiveFor, type Perspective } from '@/lib/status-meta'
import { openDocument } from '@/lib/download'
import { getErrorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/utils'
import type { CaseOut, CaseStatus, DocumentOut, Pricing } from '@/types/api'

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = usePermissions()
  const { user } = useAuth()
  const perspective = perspectiveFor(can)
  const queryClient = useQueryClient()
  // Set to the case's status right before a payment/action is kicked off;
  // polling stops itself the moment a refetch reports a *different* status,
  // with no separate effect needed to notice that and turn polling off.
  // Arriving from the checkout on the new-case page: the fee was just paid, so
  // start out waiting for the webhook to move the case on.
  const location = useLocation()
  const justPaid =
    (location.state as { confirmingPayment?: boolean } | null)?.confirmingPayment === true
  const [awaitingStatus, setAwaitingStatus] = useState<CaseStatus | null>(
    justPaid ? 'submitted' : null,
  )
  const [filesOpen, setFilesOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [quoteSheet, setQuoteSheet] = useState<'closed' | 'send' | 'replace'>('closed')

  const caseId = id!

  const {
    data: caseData,
    isLoading,
    error: caseError,
    refetch: refetchCase,
  } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => getCase(caseId),
    refetchInterval: (query) => (query.state.data?.status === awaitingStatus ? 3000 : false),
  })

  const { data: documents } = useQuery({
    queryKey: ['case-documents', caseId],
    queryFn: () => listCaseDocuments(caseId),
  })

  // The fee on the button that spends it comes from the server.
  const { data: pricing } = useQuery({
    queryKey: ['pricing'],
    queryFn: getPricing,
    staleTime: Infinity,
  })

  const { data: payments } = useQuery({
    queryKey: ['case-payments', caseId],
    queryFn: () => listPaymentsForCase(caseId),
  })

  usePageTitle(caseData ? (caseData.case_number ? `Case ${caseData.case_number}` : caseData.title) : 'Case')

  const refresh = () => {
    if (caseData) setAwaitingStatus(caseData.status)
    void queryClient.invalidateQueries({ queryKey: ['case', caseId] })
    void queryClient.invalidateQueries({ queryKey: ['case-documents', caseId] })
    void queryClient.invalidateQueries({ queryKey: ['case-payments', caseId] })
    void queryClient.invalidateQueries({ queryKey: ['quote', caseId] })
  }

  // What the lawyer submitted. Drafts are the advocate's work and get their own
  // card once a quote exists.
  const caseFiles = documents?.filter((d) => d.type !== 'draft') ?? []
  const latestDraft = documents?.filter((d) => d.type === 'draft').at(-1)

  if (caseError) {
    const status = isAxiosError(caseError) ? caseError.response?.status : undefined
    // A malformed id is a 422 from the API — same "no such case" to the user.
    if (status === 404 || status === 422) {
      return (
        <NotFoundPage
          inline
          title="Case not found"
          description="This case doesn't exist, or the link is wrong."
        />
      )
    }
    if (status === 403) return <ForbiddenPage inline />
    return <ServerErrorPage inline onRetry={() => void refetchCase()} />
  }

  if (isLoading || !caseData) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const isOwner = user?.id === caseData.junior_lawyer_id

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink to="/">All cases</BackLink>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          {caseData.case_number && (
            <p className="text-muted text-label font-medium">{caseData.case_number}</p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{caseData.title}</h1>
          <p className="text-muted mt-1 text-sm">
            {caseData.case_type}
            {caseData.court && ` · ${caseData.court}`} ·{' '}
            {caseData.status === 'draft' ? 'Started' : 'Submitted'}{' '}
            {formatDate(caseData.created_at)}
          </p>
        </div>
        <CaseStatusPill status={caseData.status} perspective={perspective} />
      </div>

      <CaseProgress status={caseData.status} />

      <div className="mb-4 space-y-4">
        <CaseActionPanel
          caseId={caseId}
          caseData={caseData}
          can={can}
          isOwner={isOwner}
          perspective={perspective}
          pricing={pricing}
          documents={documents ?? []}
          latestDraft={latestDraft}
          confirmingPayment={justPaid}
          onChanged={refresh}
          onOpenQuoteSheet={(mode) => setQuoteSheet(mode)}
        />
      </div>

      {/* The chat is for the two people on the case: its owner and whoever holds
          case:message. It exists from acceptance on (and stays, read-only, once
          the case is complete). Everyone else who can see the case never sees it. */}
      {user && hasChat(caseData, user.id, can) && (
        <div className="mb-4">
          <ChatThread
            caseId={caseId}
            ownId={user.id}
            header={
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-1.5">
                <h2 className="text-base font-semibold">Chat</h2>
                <a
                  href={`/messages/${caseId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-ink text-label inline-flex min-h-11 items-center gap-1.5 font-medium sm:min-h-9"
                >
                  <ExternalLink className="size-4" aria-hidden /> Open in new window
                </a>
              </div>
            }
          />
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setFilesOpen(true)}>
          <FolderOpen className="size-4" /> Files
          {caseFiles.length > 0 && <span className="text-muted">({caseFiles.length})</span>}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDetailsOpen(true)}>
          <Info className="size-4" /> Details
        </Button>
      </div>

      <FilesSheet open={filesOpen} onOpenChange={setFilesOpen} files={caseFiles} />
      <DetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        caseData={caseData}
        payments={payments ?? []}
      />
      {pricing && (
        <QuoteSheet
          caseId={caseId}
          pricing={pricing}
          open={quoteSheet !== 'closed'}
          onOpenChange={(open) => setQuoteSheet(open ? quoteSheet : 'closed')}
          replacing={quoteSheet === 'replace'}
          onSent={refresh}
        />
      )}
    </div>
  )
}

function CaseActionPanel({
  caseId,
  caseData,
  can,
  isOwner,
  perspective,
  pricing,
  documents,
  latestDraft,
  confirmingPayment,
  onChanged,
  onOpenQuoteSheet,
}: {
  caseId: string
  caseData: CaseOut
  can: CanFn
  isOwner: boolean
  perspective: Perspective
  pricing: Pricing | undefined
  documents: DocumentOut[]
  latestDraft: DocumentOut | undefined
  confirmingPayment: boolean
  onChanged: () => void
  onOpenQuoteSheet: (mode: 'send' | 'replace') => void
}) {
  const { toast } = useToast()
  const status = caseData.status
  // What the viewer sees when there is nothing for them to do.
  const meta = getStatusMeta(status, perspective)
  const waiting = (icon: LucideIcon) => (
    <InfoPanel icon={icon} title={meta.label} description={meta.next} />
  )

  switch (status) {
    case 'submitted':
      return can(PERMISSIONS.PAYMENT_INITIATE) ? (
        <PaymentActionCard
          createOrder={() => createReviewPayment(caseId)}
          title="Pay the review fee"
          description="Pay the review fee so the advocate can start reviewing your case."
          amountInr={pricing?.review_fee_inr}
          initiallyConfirming={confirmingPayment}
          onPaid={onChanged}
        />
      ) : (
        waiting(Hourglass)
      )

    case 'review_fee_paid':
      return can(PERMISSIONS.CASE_DECIDE) ? (
        <DecisionPanel caseId={caseId} onDecided={onChanged} />
      ) : (
        waiting(Clock)
      )

    case 'rejected':
      return (
        <InfoPanel
          icon={XCircle}
          tone="danger"
          title="Case rejected"
          description={caseData.rejection_reason ?? 'No reason was provided.'}
          action={
            isOwner && (
              <Link
                to="/cases/new"
                state={{ prefill: { title: caseData.title, case_type: caseData.case_type } }}
                className={buttonVariants({ size: 'sm', className: 'mt-3' })}
              >
                Start a new case
              </Link>
            )
          }
        />
      )

    case 'draft':
      return can(PERMISSIONS.CASE_SUBMIT) ? (
        <InfoPanel
          icon={Pencil}
          title={meta.label}
          description={meta.next}
          action={
            <Link
              to={`/cases/new?draft=${caseId}`}
              className={buttonVariants({ size: 'sm', className: 'mt-3' })}
            >
              Continue your draft
            </Link>
          }
        />
      ) : (
        waiting(Clock)
      )

    case 'accepted':
      return can(PERMISSIONS.QUOTE_CREATE) ? (
        <Card>
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
              <PenSquare className="size-5" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="font-semibold">Send draft and quote</h3>
              <p className="text-muted mt-0.5 text-sm">
                Prepare the draft, then send it with its price. The lawyer pays that price to
                unlock it.
              </p>
              <Button size="sm" className="mt-3" onClick={() => onOpenQuoteSheet('send')}>
                Send draft and quote
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        waiting(Clock)
      )

    case 'quoted':
      if (isOwner) {
        return <QuotedPaymentPanel caseId={caseId} documents={documents} onChanged={onChanged} />
      }
      return can(PERMISSIONS.QUOTE_CREATE) ? (
        <InfoPanel
          icon={Clock}
          title={meta.label}
          description={meta.next}
          action={
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => onOpenQuoteSheet('replace')}
            >
              Replace draft or change amount
            </Button>
          }
        />
      ) : (
        waiting(Clock)
      )

    case 'delivered':
      return can(PERMISSIONS.CASE_APPROVE_FINAL) ? (
        <DraftReviewPanel caseId={caseId} caseTitle={caseData.title} onChanged={onChanged} />
      ) : (
        waiting(Clock)
      )

    case 'revision_requested':
      return can(PERMISSIONS.CASE_DRAFT) ? (
        <UploadRevisionPanel caseId={caseId} onChanged={onChanged} />
      ) : (
        waiting(Clock)
      )

    case 'completed':
      return (
        <InfoPanel
          icon={FolderOpen}
          tone="success"
          title="Filing complete"
          description="This case has been completed and the final filing delivered."
          action={
            latestDraft && (
              <Button
                size="sm"
                className="mt-3"
                onClick={async () => {
                  try {
                    await openDocument(latestDraft.id)
                  } catch (err) {
                    toast({
                      variant: 'error',
                      title: 'Could not open the draft',
                      description: getErrorMessage(err),
                    })
                  }
                }}
              >
                Download final filing
              </Button>
            )
          }
        />
      )

    default:
      return null
  }
}
