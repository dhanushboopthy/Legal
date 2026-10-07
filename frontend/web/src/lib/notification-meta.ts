import {
  AlertTriangle,
  Bell,
  BadgeCheck,
  CheckCircle2,
  FileText,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  Receipt,
  RotateCcw,
  Undo2,
  type LucideIcon,
} from 'lucide-react'

export type NotificationTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral'

interface NotificationMeta {
  icon: LucideIcon
  tone: NotificationTone
}

// What each kind of notification looks like in the panel. The server's `kind`
// is free text, so anything unknown falls back to a plain bell.
const META: Record<string, NotificationMeta> = {
  chat_message: { icon: MessageCircle, tone: 'accent' },
  case_ready_for_review: { icon: FileText, tone: 'accent' },
  case_accepted: { icon: CheckCircle2, tone: 'success' },
  case_held_over: { icon: PauseCircle, tone: 'warning' },
  case_resumed: { icon: PlayCircle, tone: 'accent' },
  quote_sent: { icon: Receipt, tone: 'accent' },
  quote_paid: { icon: BadgeCheck, tone: 'success' },
  review_paid: { icon: BadgeCheck, tone: 'success' },
  draft_revised: { icon: FileText, tone: 'accent' },
  revision_requested: { icon: RotateCcw, tone: 'warning' },
  payment_refunded: { icon: Undo2, tone: 'warning' },
  payment_failed: { icon: AlertTriangle, tone: 'danger' },
  payment_problem: { icon: AlertTriangle, tone: 'danger' },
}

export function notificationMeta(kind: string | null): NotificationMeta {
  return (kind && META[kind]) || { icon: Bell, tone: 'neutral' }
}

// Fill tints with the matching dark ink for the icon (design-system: ink for
// text and icons on a tint, never the bright fill).
export const TONE_CLASSES: Record<NotificationTone, string> = {
  accent: 'bg-[var(--color-accent)]/10 text-[var(--color-accent-ink)]',
  success: 'bg-[var(--color-success)]/10 text-[var(--color-success-ink)]',
  warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning-ink)]',
  danger: 'bg-[var(--color-danger)]/10 text-[var(--color-danger-ink)]',
  neutral: 'bg-ink/[0.06] text-[var(--fg)]',
}
