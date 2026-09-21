import { PERMISSIONS, type CanFn } from '@/auth/permissions'
import type { CaseStatus } from '@/types/api'

// The one place case statuses get their words, colour and "whose turn".
// Pills, list filters and (later) the action card all read from here instead
// of switching on status themselves.
//
// Labels describe the person's situation, not a system state (F-18), and
// carry no amounts: fees come from the server and are shown next to the
// button that spends them.

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export type Turn = 'you' | 'them' | 'none'
export type StatusGroup = 'active' | 'completed' | 'rejected'

// Who is looking. The person who files cases sees their own situation; anyone
// else who can see cases (the advocate, a clerk) sees the reviewer's view.
export type Perspective = 'submitter' | 'reviewer'

export function perspectiveFor(can: CanFn): Perspective {
  return can(PERMISSIONS.CASE_SUBMIT) ? 'submitter' : 'reviewer'
}

interface PerspectiveMeta {
  label: string
  turn: Turn
  next: string
}

interface StatusMeta {
  tone: Tone
  group: StatusGroup
  submitter: PerspectiveMeta
  reviewer: PerspectiveMeta
}

const inReview: StatusMeta = {
  tone: 'info',
  group: 'active',
  submitter: {
    label: 'In review',
    turn: 'them',
    next: "The advocate is reviewing your case. You'll be notified once a decision is made.",
  },
  reviewer: {
    label: 'Needs your decision',
    turn: 'you',
    next: 'Accept or decline this case.',
  },
}

const completed: StatusMeta = {
  tone: 'success',
  group: 'completed',
  submitter: { label: 'Completed', turn: 'none', next: 'This case is complete.' },
  reviewer: { label: 'Completed', turn: 'none', next: 'This case is complete.' },
}

export const STATUS_META: Record<CaseStatus, StatusMeta> = {
  // --- new flow (docs/NEW_FLOW_SPEC.md §3); not emitted by the API yet ---
  draft: {
    tone: 'neutral',
    group: 'active',
    submitter: {
      label: 'Draft: add files',
      turn: 'you',
      next: 'Add your files and submit to send this for review.',
    },
    reviewer: { label: 'Draft', turn: 'none', next: "The lawyer hasn't submitted this yet." },
  },
  quoted: {
    tone: 'warning',
    group: 'active',
    submitter: {
      label: 'Draft ready: pay to unlock',
      turn: 'you',
      next: 'Pay the quoted amount to unlock the download.',
    },
    reviewer: {
      label: 'Waiting for payment',
      turn: 'them',
      next: 'Waiting for the lawyer to pay. You can still replace the draft or change the amount.',
    },
  },
  delivered: {
    tone: 'success',
    group: 'active',
    submitter: {
      label: 'Ready to download',
      turn: 'you',
      next: 'Download your draft. Approve it, or ask for changes.',
    },
    reviewer: {
      label: 'Delivered',
      turn: 'them',
      next: 'Delivered. Waiting for the lawyer to approve or ask for changes.',
    },
  },

  // --- statuses shared by the current and the new flow ---
  submitted: {
    tone: 'neutral',
    group: 'active',
    submitter: {
      label: 'Payment due',
      turn: 'you',
      next: 'Pay the review fee so the advocate can start reviewing your case.',
    },
    reviewer: {
      label: 'Awaiting payment',
      turn: 'them',
      next: 'The lawyer needs to pay the review fee before you can review this case.',
    },
  },
  review_fee_paid: inReview,
  rejected: {
    tone: 'danger',
    group: 'rejected',
    submitter: {
      label: 'Not accepted',
      turn: 'none',
      next: "The advocate didn't accept this case.",
    },
    reviewer: { label: 'Declined', turn: 'none', next: 'You declined this case.' },
  },
  // Until Phase 1.2 replaces the drafting fee with a quote, "accepted" still
  // means the lawyer owes the drafting fee.
  accepted: {
    tone: 'info',
    group: 'active',
    submitter: {
      label: 'Accepted: pay drafting fee',
      turn: 'you',
      next: 'Your case was accepted. Pay the drafting fee to begin.',
    },
    reviewer: {
      label: 'Waiting for drafting payment',
      turn: 'them',
      next: 'The lawyer needs to pay the drafting fee before you can begin drafting.',
    },
  },
  revision_requested: {
    tone: 'warning',
    group: 'active',
    submitter: {
      label: 'Changes requested',
      turn: 'them',
      next: 'The advocate is working on the changes you asked for.',
    },
    reviewer: {
      label: 'Changes requested',
      turn: 'you',
      next: 'Upload a new version with the requested changes.',
    },
  },
  completed,

  // --- legacy statuses, deleted with the old flow in Phase 1.2 ---
  under_review: inReview,
  drafting_fee_paid: {
    tone: 'info',
    group: 'active',
    submitter: {
      label: 'Drafting in progress',
      turn: 'them',
      next: 'The advocate is preparing your filing.',
    },
    reviewer: { label: 'Needs your draft', turn: 'you', next: 'Upload the draft for this case.' },
  },
  drafting: {
    tone: 'info',
    group: 'active',
    submitter: {
      label: 'Drafting in progress',
      turn: 'them',
      next: 'The advocate is preparing your filing.',
    },
    reviewer: { label: 'Needs your draft', turn: 'you', next: 'Upload the draft for this case.' },
  },
  draft_delivered: {
    tone: 'warning',
    group: 'active',
    submitter: {
      label: 'Draft ready to review',
      turn: 'you',
      next: 'Review the draft, then approve it or request changes.',
    },
    reviewer: {
      label: 'Draft delivered',
      turn: 'them',
      next: 'Waiting for the lawyer to review the draft.',
    },
  },
  approved: completed,
}

export function getStatusMeta(status: CaseStatus, perspective: Perspective) {
  const meta = STATUS_META[status]
  return { tone: meta.tone, group: meta.group, ...meta[perspective] }
}
