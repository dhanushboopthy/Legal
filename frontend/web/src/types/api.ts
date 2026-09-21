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
}

export interface Token {
  access_token: string
  refresh_token?: string
  token_type: string
}

export interface CaseOut {
  id: string
  junior_lawyer_id: string
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

export interface UploadUrlResponse {
  upload_url: string
  storage_key: string
  expires_in_seconds: number
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
