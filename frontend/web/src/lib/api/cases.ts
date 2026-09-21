import { apiClient } from '@/lib/api-client'
import type { CaseOut, PaymentOrderResponse } from '@/types/api'

export interface CreateCasePayload {
  title: string
  case_type: string
  court?: string
  description?: string
}

export async function listCases(): Promise<CaseOut[]> {
  const { data } = await apiClient.get<CaseOut[]>('/cases')
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
