// Hand-written mirrors of the backend Pydantic schemas actually consumed by
// this app. Keep in sync with app/schemas/*.py and app/models/*.py.

export type CaseStatus =
  | 'draft'
  | 'submitted'
  | 'review_fee_paid'
  | 'rejected'
  | 'accepted'
  | 'quoted'
  | 'delivered'
  | 'revision_requested'
  | 'completed'

// 'drafting' and 'revision' are retired fixed fees; they only appear on old rows.
export type PaymentType = 'review' | 'quote' | 'drafting' | 'revision'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'
export type DocumentType = 'original' | 'supporting' | 'draft'
export type QuoteStatus = 'open' | 'paid' | 'superseded' | 'refunded'

export interface UserOut {
  id: string
  full_name: string
  email: string
  phone: string | null
  bar_council_id: string | null
  role_name: string
  permissions: string[]
  is_active: boolean
  is_verified: boolean
  created_at: string
}

export interface Token {
  access_token: string
  refresh_token?: string
  token_type: string
}

export interface CaseOut {
  id: string
  junior_lawyer_id: string
  case_number: string | null
  title: string
  case_type: string
  court: string | null
  description: string | null
  note: string | null
  status: CaseStatus
  rejection_reason: string | null
  revision_count: number
  created_at: string
  updated_at: string
}

export type MessageKind = 'text' | 'file' | 'system' | 'quote' | 'draft'

export interface AttachmentOut {
  document_id: string
  filename: string
  size_bytes: number | null
  content_type: string | null
}

export interface MessageOut {
  id: number
  case_id: string
  sender_id: string | null
  sender_name: string | null
  kind: MessageKind
  body: string | null
  // What a card or system line needs (amounts, filenames, the event name).
  meta: Record<string, unknown>
  attachments: AttachmentOut[]
  client_id: string | null
  created_at: string
}

export interface MessagePage {
  messages: MessageOut[] // oldest first
  has_more: boolean
  my_last_read_id: number
  other_last_read_id: number
  // False once the case is complete: readable, but nothing can be added.
  open: boolean
}

export interface LastMessage {
  preview: string
  at: string
  sender_name: string | null
  kind: MessageKind
}

export type Turn = 'you' | 'them' | 'none'

// A case as the list returns it, with what the list says about its chat.
export interface CaseListItem extends CaseOut {
  last_message: LastMessage | null
  unread_count: number
  turn: Turn
  // Only meaningful to a viewer with case:view_all (the advocate's list).
  junior_lawyer_name: string
  junior_lawyer_bar_council_id: string | null
}

export interface PaymentOrderResponse {
  payment_id: string
  razorpay_order_id: string
  razorpay_key_id: string
  amount_paise: number
  currency: string
}

export interface PaymentOut {
  id: string
  case_id: string
  type: PaymentType
  amount: number
  currency: string
  status: PaymentStatus
  quote_id: string | null
  paid_at: string | null
}

// A row in the admin payments table: which case and whose it is.
export interface PaymentListItem extends PaymentOut {
  case_number: string | null
  case_title: string
  junior_lawyer_name: string
}

export interface DocumentOut {
  id: string
  case_id: string
  type: DocumentType
  version: number
  original_filename: string
  size_bytes: number | null
  content_type: string | null
  page_count: number | null
  uploaded_by: string
  created_at: string
  // A draft the viewer can see but not open until the quote is paid.
  locked: boolean
}

export interface QuoteOut {
  id: string
  case_id: string
  version: number
  amount_inr: number
  amount_paise: number
  currency: string
  note: string | null
  status: QuoteStatus
  draft_document_id: string
  created_at: string
  paid_at: string | null
}

export interface RevisionOut {
  id: string
  reason: string
  status: 'pending' | 'resolved'
  created_at: string
}

// One signed PUT per file the lawyer adds to a case (POST /documents/upload-urls).
export interface UploadTarget {
  filename: string
  content_type: string
  size: number
  storage_key: string
  upload_url: string
  expires_in_seconds: number
}

// A signed PUT for the advocate's single draft PDF (POST /documents/upload-url).
export interface UploadUrlResponse {
  upload_url: string
  storage_key: string
  expires_in_seconds: number
}

export interface RejectedFile {
  storage_key: string
  original_filename: string
  reason: string
}

// Each file stands or falls alone, so a retry only redoes what failed.
export interface ConfirmBatchResponse {
  confirmed: DocumentOut[]
  rejected: RejectedFile[]
}

export interface UploadRules {
  max_files: number
  max_file_size_mb: number
  max_case_size_mb: number
  // extension -> content type, e.g. { '.pdf': 'application/pdf' }
  accepted: Record<string, string>
}

export interface Pricing {
  review_fee_inr: number
  quote_min_inr: number
  quote_max_inr: number
}

export interface NotificationOut {
  id: string
  message: string
  case_id: string | null
  kind: string | null
  is_read: boolean
  created_at: string
}

export interface ApiError {
  detail: string
}
