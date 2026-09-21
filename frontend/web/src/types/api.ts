// Hand-written mirrors of the backend Pydantic schemas actually consumed by
// this app. Keep in sync with app/schemas/*.py and app/models/*.py.

export type CaseStatus =
  // 'draft', 'quoted' and 'delivered' belong to the new flow
  // (docs/NEW_FLOW_SPEC.md); the API doesn't emit them until Phase 1.
  | 'draft'
  | 'quoted'
  | 'delivered'
  | 'submitted'
  | 'review_fee_paid'
  | 'under_review'
  | 'rejected'
  | 'accepted'
  | 'drafting_fee_paid'
  | 'drafting'
  | 'draft_delivered'
  | 'revision_requested'
  | 'approved'
  | 'completed'

export type PaymentType = 'review' | 'drafting' | 'revision'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'
export type DocumentType = 'original' | 'draft' | 'final'

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
  paid_at: string | null
}

export interface DocumentOut {
  id: string
  case_id: string
  type: DocumentType
  version: number
  original_filename: string
  uploaded_by: string
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
  is_read: boolean
  created_at: string
}

export interface ApiError {
  detail: string
}
