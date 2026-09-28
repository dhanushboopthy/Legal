import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Clock,
  FolderOpen,
  Hourglass,
  MessageCircle,
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
import { List, ListRow } from '@/components/ui/list'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast-context'
import { ForbiddenPage } from '@/features/errors/forbidden-page'
import { NotFoundPage } from '@/features/errors/not-found-page'
import { ServerErrorPage } from '@/features/errors/server-error-page'
import { hasChat } from '@/features/chat/chat-access'
import { CaseDetailsSheet } from '@/features/cases/case-details-sheet'
import { stepLine } from '@/features/cases/case-steps'
import { DecisionPanel } from '@/features/cases/decision-panel'
import { DraftReviewPanel } from '@/features/cases/draft-review-panel'
import { InfoPanel } from '@/features/cases/info-panel'
import { QuotedPaymentPanel } from '@/features/cases/quoted-payment-panel'
import { QuoteSheet } from '@/features/cases/quote-sheet'
import { PaymentActionCard } from '@/features/cases/review-payment-panel'
import { UploadRevisionPanel } from '@/features/cases/upload-revision-panel'
import { createReviewPayment, getCase, listCases } from '@/lib/api/cases'
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

  // Unread count and last message for the Messages row, from the Cases list.
  const { data: casesList } = useQuery({ queryKey: ['cases'], queryFn: listCases })

  usePageTitle(
    caseData ? (caseData.case_number ? `Case ${caseData.case_number}` : caseData.title) : 'Case',
  )

  const refresh = () => {
    if (caseData) setAwaitingStatus(caseData.status)
    void queryClient.invalidateQueries({ queryKey: ['case', caseId] })
    void queryClient.invalidateQueries({ queryKey: ['case-documents', caseId] })
    void queryClient.invalidateQueries({ queryKey: ['case-payments', caseId] })
    void queryClient.invalidateQueries({ queryKey: ['quote', caseId] })
  }

  const caseFiles = documents?.filter((d) => d.type !== 'draft') ?? []
  const draftCount = (documents?.length ?? 0) - caseFiles.length
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
  const listed = casesList?.find((c) => c.id === caseId)
  const unread = listed?.unread_count ?? 0
  const lastMessage = listed?.last_message
  const chatSummary = lastMessage
    ? `${lastMessage.sender_id === user?.id ? 'You: ' : ''}${lastMessage.preview}`
    : perspective === 'reviewer'
      ? 'Talk to the lawyer'
      : 'Talk to the advocate'
  const step = stepLine(caseData.status)
  const detailsSummary = [
    `${caseFiles.length} ${caseFiles.length === 1 ? 'file' : 'files'}`,
    draftCount > 0 && `${draftCount} ${draftCount === 1 ? 'draft' : 'drafts'}`,
    (payments?.length ?? 0) > 0 &&
      `${payments!.length} ${payments!.length === 1 ? 'payment' : 'payments'}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink to="/">All cases</BackLink>
      <header className="mb-8">
        {caseData.case_number && (
          <p className="text-muted text-sm font-medium tabular-nums">{caseData.case_number}</p>
        )}
        <h1 className="lg:text-title mt-1 text-2xl font-semibold break-words">{caseData.title}</h1>
        <p className="text-muted mt-2 text-sm">
          {caseData.case_type}
          {caseData.court && ` · ${caseData.court}`} ·{' '}
          {caseData.status === 'draft' ? 'Started' : 'Submitted'} {formatDate(caseData.created_at)}
        </p>
      </header>

      {/* One card says where the case is and what to do next. */}
      <section aria-label="Next step" className="mb-8">
        {step && <p className="text-muted mb-2 px-1 text-sm font-medium">{step}</p>}
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
      </section>

      <List>
        {/* The chat lives on the Messages screen. It is for the two people on
            the case (its owner and whoever holds case:message), from acceptance
            on; everyone else who can see the case never gets this row. */}
        {user && hasChat(caseData, user.id, can) && (
          <ListRow
            to={`/messages/${caseId}`}
            icon={MessageCircle}
            title="Messages"
            subtitle={chatSummary}
            trailing={
              unread > 0 ? (
                <span className="text-caption inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 font-semibold text-white">
                  {unread}
                  <span className="sr-only"> unread</span>
                </span>
              ) : undefined
            }
          />
        )}
        <ListRow
          icon={FolderOpen}
          title="Case details"
          subtitle={detailsSummary}
          onClick={() => setDetailsOpen(true)}
        />
      </List>

      <CaseDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        caseData={caseData}
        documents={documents ?? []}
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
                className={buttonVariants({ className: 'mt-4' })}
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
              className={buttonVariants({ className: 'mt-4' })}
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
            <div className="hidden size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent-ink)] sm:flex">
              <PenSquare className="size-5" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="font-semibold">Send draft and quote</h3>
              <p className="text-muted mt-0.5 text-sm">
                Prepare the draft, then send it with its price. The lawyer pays that price to unlock
                it.
              </p>
              <Button className="mt-4" onClick={() => onOpenQuoteSheet('send')}>
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
              variant="secondary"
              className="mt-4"
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
                className="mt-4"
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
