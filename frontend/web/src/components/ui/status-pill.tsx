import { getStatusMeta, type Perspective, type Tone } from '@/lib/status-meta'
import { cn } from '@/lib/utils'
import type { CaseStatus, PaymentStatus } from '@/types/api'

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

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-black/[0.06] text-[var(--fg-muted)]',
  info: 'bg-accent/10 text-accent-ink',
  success: 'bg-success/10 text-success-ink',
  warning: 'bg-warning/10 text-warning-ink',
  danger: 'bg-danger/10 text-danger-ink',
}

function Pill({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span
      className={cn(
        'text-caption inline-flex items-center rounded-full px-2.5 py-1 font-medium',
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  )
}

export function CaseStatusPill({
  status,
  perspective,
}: {
  status: CaseStatus
  perspective: Perspective
}) {
  const { tone, label } = getStatusMeta(status, perspective)
  return <Pill tone={tone}>{label}</Pill>
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return <Pill tone={PAYMENT_STATUS_TONE[status]}>{PAYMENT_STATUS_LABEL[status]}</Pill>
}
