import { apiClient } from '@/lib/api-client'
import type { CaseListItem, CaseOut, PaymentOrderResponse, QuoteOut } from '@/types/api'

export interface CreateCasePayload {
  title: string
  case_type: string
  note?: string
}

export async function listCases(): Promise<CaseListItem[]> {
  const { data } = await apiClient.get<CaseListItem[]>('/cases')
  return data
}

export async function getCase(caseId: string): Promise<CaseOut> {
  const { data } = await apiClient.get<CaseOut>(`/cases/${caseId}`)
  return data
}

export async function createCase(payload: CreateCasePayload): Promise<CaseOut> {
  const { data } = await apiClient.post<CaseOut>('/cases', payload)
  return data
}

// Creates the case as a private draft; it is hidden from the advocate and
// can't be paid for until it is submitted.
export async function updateCase(
  caseId: string,
  payload: Partial<CreateCasePayload>,
): Promise<CaseOut> {
  const { data } = await apiClient.patch<CaseOut>(`/cases/${caseId}`, payload)
  return data
}

export async function submitCase(caseId: string): Promise<CaseOut> {
  const { data } = await apiClient.post<CaseOut>(`/cases/${caseId}/submit`)
  return data
}

export async function discardCase(caseId: string): Promise<void> {
  await apiClient.delete(`/cases/${caseId}`)
}

export async function createReviewPayment(caseId: string): Promise<PaymentOrderResponse> {
  const { data } = await apiClient.post<PaymentOrderResponse>(`/cases/${caseId}/review-payment`)
  return data
}

export async function decideCase(
  caseId: string,
  payload: { accept: boolean; rejection_reason?: string },
): Promise<CaseOut> {
  const { data } = await apiClient.patch<CaseOut>(`/cases/${caseId}/decision`, payload)
  return data
}

// Free: the price of the draft already covers revisions.
export async function requestRevision(caseId: string, reason: string): Promise<CaseOut> {
  const { data } = await apiClient.post<CaseOut>(`/cases/${caseId}/revision`, { reason })
  return data
}

export async function approveCase(caseId: string): Promise<CaseOut> {
  const { data } = await apiClient.post<CaseOut>(`/cases/${caseId}/approve`)
  return data
}

export interface SendQuotePayload {
  draft: { storage_key: string; original_filename: string }
  amount_inr: number
  note?: string
}

// The draft and its price together, and how either is replaced while the
// quote is still unpaid: a second call here supersedes the open one.
export async function sendQuote(caseId: string, payload: SendQuotePayload): Promise<QuoteOut> {
  const { data } = await apiClient.post<QuoteOut>(`/cases/${caseId}/quote`, payload)
  return data
}

export async function getQuote(caseId: string): Promise<QuoteOut> {
  const { data } = await apiClient.get<QuoteOut>(`/cases/${caseId}/quote`)
  return data
}

// The amount is read from the quote on the server, never sent here.
export async function payQuote(caseId: string): Promise<PaymentOrderResponse> {
  const { data } = await apiClient.post<PaymentOrderResponse>(`/cases/${caseId}/quote/pay`)
  return data
}

// A new draft version once changes were requested; the quote was already
// paid, so the lawyer can download it as soon as it's filed.
export async function uploadRevisedDraft(
  caseId: string,
  payload: { storage_key: string; original_filename: string },
): Promise<void> {
  await apiClient.post(`/cases/${caseId}/drafts`, payload)
}
