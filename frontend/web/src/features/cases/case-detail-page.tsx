import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, Download, FileText, Hourglass, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CaseStatusPill, PaymentStatusPill } from '@/components/ui/status-pill'
import { useToast } from '@/components/ui/toast-context'
import { DecisionPanel } from '@/features/cases/decision-panel'
import { DraftReviewPanel } from '@/features/cases/draft-review-panel'
import { DraftUploadPanel } from '@/features/cases/draft-upload-panel'
import { InfoPanel } from '@/features/cases/info-panel'
import { PaymentActionCard } from '@/features/cases/review-payment-panel'
import { createDraftingPayment, createReviewPayment, getCase } from '@/lib/api/cases'
import { getDownloadUrl, listCaseDocuments } from '@/lib/api/documents'
import { listPaymentsForCase } from '@/lib/api/payments'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { CaseStatus } from '@/types/api'

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = user?.role_name === 'super_admin'
  // Set to the case's status right before a payment/action is kicked off;
  // polling stops itself the moment a refetch reports a *different* status,
  // with no separate effect needed to notice that and turn polling off.
  const [awaitingStatus, setAwaitingStatus] = useState<CaseStatus | null>(null)

  const caseId = id!

  const { data: caseData, isLoading } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => getCase(caseId),
    refetchInterval: (query) => (query.state.data?.status === awaitingStatus ? 3000 : false),
  })

  const { data: documents } = useQuery({
    queryKey: ['case-documents', caseId],
    queryFn: () => listCaseDocuments(caseId),
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

  const originalDoc = documents?.find((d) => d.type === 'original')

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
            {caseData.court && ` · ${caseData.court}`} · Submitted {formatDate(caseData.created_at)}
          </p>
        </div>
        <CaseStatusPill status={caseData.status} />
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
          isAdmin={isAdmin}
          rejectionReason={caseData.rejection_reason}
          onChanged={refresh}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-muted mb-3 text-sm font-semibold">Documents</h3>
          {originalDoc ? (
            <DocumentRow filename={originalDoc.original_filename} documentId={originalDoc.id} />
          ) : (
            <p className="text-muted text-[13px]">No original document uploaded.</p>
          )}
        </Card>
        <Card>
          <h3 className="text-muted mb-3 text-sm font-semibold">Payments</h3>
          {payments && payments.length > 0 ? (
            <ul className="space-y-2">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-[13px]">
                  <span className="capitalize">{p.type} fee</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted">{formatCurrency(p.amount)}</span>
                    <PaymentStatusPill status={p.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted text-[13px]">No payments yet.</p>
          )}
        </Card>
      </div>
    </div>
  )
}

function DocumentRow({ filename, documentId }: { filename: string; documentId: string }) {
  const { toast } = useToast()
  return (
    <button
      onClick={async () => {
        try {
          const url = await getDownloadUrl(documentId)
          window.open(url, '_blank')
        } catch {
          toast({ variant: 'error', title: 'Could not get download link' })
        }
      }}
      className="flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2 text-left text-[13px] transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
    >
      <FileText className="size-4 text-[var(--fg-muted)]" />
      <span className="flex-1 truncate">{filename}</span>
      <Download className="size-4 text-[var(--fg-muted)]" />
    </button>
  )
}

function CaseActionPanel({
  caseId,
  status,
  isAdmin,
  rejectionReason,
  onChanged,
}: {
  caseId: string
  status: CaseStatus
  isAdmin: boolean
  rejectionReason: string | null
  onChanged: () => void
}) {
  switch (status) {
    case 'submitted':
      return isAdmin ? (
        <InfoPanel
          icon={Hourglass}
          title="Awaiting review payment"
          description="The junior lawyer needs to pay the review fee before you can review this case."
        />
      ) : (
        <PaymentActionCard
          createOrder={() => createReviewPayment(caseId)}
          title="Pay the review fee"
          description="Pay the review fee so the advocate can start reviewing your case."
          onPaid={onChanged}
        />
      )

    case 'review_fee_paid':
    case 'under_review':
      return isAdmin ? (
        <DecisionPanel caseId={caseId} onDecided={onChanged} />
      ) : (
        <InfoPanel
          icon={Clock}
          title="Under review"
          description="The advocate is reviewing your case. You'll be notified once a decision is made."
        />
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

    case 'accepted':
      return isAdmin ? (
        <InfoPanel
          icon={Hourglass}
          title="Awaiting drafting payment"
          description="The junior lawyer needs to pay the drafting fee before you can begin drafting."
        />
      ) : (
        <PaymentActionCard
          createOrder={() => createDraftingPayment(caseId)}
          title="Pay the drafting fee"
          description="Your case was accepted — pay the drafting fee to begin."
          onPaid={onChanged}
        />
      )

    case 'drafting_fee_paid':
    case 'drafting':
    case 'revision_requested':
      return isAdmin ? (
        <DraftUploadPanel caseId={caseId} onUploaded={onChanged} />
      ) : (
        <InfoPanel
          icon={Clock}
          title="Drafting in progress"
          description="The advocate is preparing your filing."
        />
      )

    case 'draft_delivered':
      return isAdmin ? (
        <InfoPanel
          icon={Clock}
          title="Draft delivered"
          description="Waiting for the junior lawyer to review the draft."
        />
      ) : (
        <DraftReviewPanel caseId={caseId} onChanged={onChanged} />
      )

    case 'approved':
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
