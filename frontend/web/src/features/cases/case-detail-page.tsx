import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Clock,
  Download,
  FileText,
  Hourglass,
  Pencil,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { isAxiosError } from 'axios'
import { Link, useLocation, useParams } from 'react-router-dom'

import { PERMISSIONS, type CanFn } from '@/auth/permissions'
import { useAuth } from '@/auth/auth-context'
import { usePermissions } from '@/auth/use-permissions'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CaseStatusPill, PaymentStatusPill } from '@/components/ui/status-pill'
import { useToast } from '@/components/ui/toast-context'
import { ForbiddenPage } from '@/features/errors/forbidden-page'
import { NotFoundPage } from '@/features/errors/not-found-page'
import { ServerErrorPage } from '@/features/errors/server-error-page'
import { ChatThread } from '@/features/chat/chat-thread'
import { DecisionPanel } from '@/features/cases/decision-panel'
import { DraftReviewPanel } from '@/features/cases/draft-review-panel'
import { InfoPanel } from '@/features/cases/info-panel'
import { PaymentActionCard } from '@/features/cases/review-payment-panel'
import { createReviewPayment, getCase } from '@/lib/api/cases'
import { getPricing } from '@/lib/api/config'
import { getDownloadUrl, listCaseDocuments } from '@/lib/api/documents'
import { getErrorMessage } from '@/lib/errors'
import { listPaymentsForCase } from '@/lib/api/payments'
import { getStatusMeta, perspectiveFor, type Perspective } from '@/lib/status-meta'
import { formatBytes } from '@/lib/uploads'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { CaseStatus } from '@/types/api'

// The statuses in which a case has a chat (docs/NEW_FLOW_SPEC.md D4).
const CHAT_STATUSES: CaseStatus[] = [
  'accepted',
  'quoted',
  'delivered',
  'revision_requested',
  'completed',
]

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

  const refresh = () => {
    if (caseData) setAwaitingStatus(caseData.status)
    void queryClient.invalidateQueries({ queryKey: ['case', caseId] })
    void queryClient.invalidateQueries({ queryKey: ['case-documents', caseId] })
    void queryClient.invalidateQueries({ queryKey: ['case-payments', caseId] })
  }

  // What the lawyer submitted. Drafts are the advocate's work and get their own
  // card once a quote exists.
  const caseFiles = documents?.filter((d) => d.type !== 'draft') ?? []

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

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
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

      {caseData.description && (
        <Card className="mb-4">
          <p className="text-sm whitespace-pre-wrap">{caseData.description}</p>
        </Card>
      )}

      <div className="mb-4 space-y-4">
        <CaseActionPanel
          caseId={caseId}
          status={caseData.status}
          can={can}
          perspective={perspective}
          rejectionReason={caseData.rejection_reason}
          reviewFeeInr={pricing?.review_fee_inr}
          confirmingPayment={justPaid}
          onChanged={refresh}
        />
      </div>

      {/* The chat is for the two people on the case: its owner and whoever holds
          case:message. It exists from acceptance on (and stays, read-only, once
          the case is complete). Everyone else who can see the case never sees it. */}
      {user &&
        CHAT_STATUSES.includes(caseData.status) &&
        (caseData.junior_lawyer_id === user.id || can(PERMISSIONS.CASE_MESSAGE)) && (
          <div className="mb-4">
            <ChatThread caseId={caseId} ownId={user.id} />
          </div>
        )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-muted mb-3 text-sm font-semibold">Documents</h3>
          {caseFiles.length > 0 ? (
            <ul className="space-y-2">
              {caseFiles.map((doc) => (
                <li key={doc.id}>
                  <DocumentRow
                    filename={doc.original_filename}
                    size={doc.size_bytes}
                    documentId={doc.id}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted text-label">No documents uploaded.</p>
          )}
        </Card>
        <Card>
          <h3 className="text-muted mb-3 text-sm font-semibold">Payments</h3>
          {payments && payments.length > 0 ? (
            <ul className="space-y-2">
              {payments.map((p) => (
                <li key={p.id} className="text-label flex items-center justify-between">
                  <span className="capitalize">{p.type} fee</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted">{formatCurrency(p.amount)}</span>
                    <PaymentStatusPill status={p.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted text-label">No payments yet.</p>
          )}
        </Card>
      </div>
    </div>
  )
}

function DocumentRow({
  filename,
  size,
  documentId,
}: {
  filename: string
  size: number | null
  documentId: string
}) {
  const { toast } = useToast()
  return (
    <button
      onClick={async () => {
        try {
          const url = await getDownloadUrl(documentId)
          window.open(url, '_blank')
        } catch (err) {
          toast({
            variant: 'error',
            title: 'Could not get download link',
            description: getErrorMessage(err),
          })
        }
      }}
      className="text-label flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2 text-left transition-colors hover:bg-black/[0.02]"
    >
      <FileText className="size-4 text-[var(--fg-muted)]" />
      <span className="flex-1 truncate">{filename}</span>
      {size !== null && <span className="text-muted text-caption">{formatBytes(size)}</span>}
      <Download className="size-4 text-[var(--fg-muted)]" />
    </button>
  )
}

function CaseActionPanel({
  caseId,
  status,
  can,
  perspective,
  rejectionReason,
  reviewFeeInr,
  confirmingPayment,
  onChanged,
}: {
  caseId: string
  status: CaseStatus
  can: CanFn
  perspective: Perspective
  rejectionReason: string | null
  reviewFeeInr: number | undefined
  confirmingPayment: boolean
  onChanged: () => void
}) {
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
          amountInr={reviewFeeInr}
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
          description={rejectionReason ?? 'No reason was provided.'}
        />
      )

    // The draft-and-price, pay-to-unlock and new-version screens are built in
    // phase 4 of the UX plan; until then these states show where the case is.
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
    case 'quoted':
    case 'revision_requested':
      return waiting(Clock)

    case 'delivered':
      return can(PERMISSIONS.CASE_APPROVE_FINAL) ? (
        <DraftReviewPanel caseId={caseId} onChanged={onChanged} />
      ) : (
        waiting(Clock)
      )

    case 'completed':
      return (
        <InfoPanel
          icon={Download}
          tone="success"
          title="Filing complete"
          description="This case has been completed and the final filing delivered."
        />
      )

    default:
      return null
  }
}
