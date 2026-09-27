import { AlertTriangle, CheckCircle2, Clock, Info, XCircle, type LucideIcon } from 'lucide-react'

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
  neutral: 'bg-black/[0.04] text-[var(--fg)] border border-[var(--border-strong)]',
  info: 'bg-accent/10 text-accent-ink',
  success: 'bg-success/10 text-success-ink',
  warning: 'bg-warning/10 text-warning-ink',
  danger: 'bg-danger/10 text-danger-ink',
}

// An icon per tone, so the pill never relies on colour alone.
const TONE_ICONS: Record<Tone, LucideIcon> = {
  neutral: Clock,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
}

function Pill({ tone, children }: { tone: Tone; children: string }) {
  const Icon = TONE_ICONS[tone]
  return (
    <span
      className={cn(
        'text-label inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold',
        TONE_CLASSES[tone],
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
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
