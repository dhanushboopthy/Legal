import type { CaseStatus, PaymentStatus } from '@/types/api'
import { cn } from '@/lib/utils'

const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  submitted: 'Submitted',
  review_fee_paid: 'Review fee paid',
  under_review: 'Under review',
  rejected: 'Rejected',
  accepted: 'Accepted',
  drafting_fee_paid: 'Drafting fee paid',
  drafting: 'Drafting',
  draft_delivered: 'Draft delivered',
  revision_requested: 'Revision requested',
  approved: 'Approved',
  completed: 'Completed',
}

const CASE_STATUS_TONE: Record<CaseStatus, Tone> = {
  submitted: 'neutral',
  review_fee_paid: 'info',
  under_review: 'info',
  rejected: 'danger',
  accepted: 'info',
  drafting_fee_paid: 'info',
  drafting: 'info',
  draft_delivered: 'warning',
  revision_requested: 'warning',
  approved: 'success',
  completed: 'success',
}

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
}

const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  pending: 'neutral',
  paid: 'success',
  failed: 'danger',
  refunded: 'warning',
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-black/[0.06] text-[var(--fg-muted)] dark:bg-white/[0.08]',
  info: 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
  success: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
}

function Pill({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium',
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  )
}

export function CaseStatusPill({ status }: { status: CaseStatus }) {
  return <Pill tone={CASE_STATUS_TONE[status]}>{CASE_STATUS_LABEL[status]}</Pill>
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return <Pill tone={PAYMENT_STATUS_TONE[status]}>{PAYMENT_STATUS_LABEL[status]}</Pill>
}
