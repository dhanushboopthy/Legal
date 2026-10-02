import { apiClient } from '@/lib/api-client'
import type { OfflineMethod, PaymentListItem, PaymentOut } from '@/types/api'

export async function listPaymentsForCase(caseId: string): Promise<PaymentOut[]> {
  const { data } = await apiClient.get<PaymentOut[]>(`/payments/case/${caseId}`)
  return data
}

export async function listAllPayments(): Promise<PaymentListItem[]> {
  const { data } = await apiClient.get<PaymentListItem[]>('/payments')
  return data
}

export async function refundPayment(paymentId: string): Promise<PaymentOut> {
  const { data } = await apiClient.post<PaymentOut>(`/payments/${paymentId}/refund`)
  return data
}

// "Check status": ask Razorpay directly when the webhook hasn't arrived yet.
// Safe to call any time; a captured payment is processed exactly as the
// webhook would be, so this can't double-apply one.
export async function reconcilePayment(paymentId: string): Promise<PaymentOut> {
  const { data } = await apiClient.post<PaymentOut>(`/payments/${paymentId}/reconcile`)
  return data
}

// The drafting charges were paid in cash, by GPay/UPI, bank transfer or
// cheque: unlock the draft. There is no amount; the server uses the quote's.
export async function recordOfflinePayment(
  caseId: string,
  payload: { method: OfflineMethod; reference?: string },
): Promise<PaymentOut> {
  const { data } = await apiClient.post<PaymentOut>(
    `/cases/${caseId}/quote/record-payment`,
    payload,
  )
  return data
}

export const OFFLINE_METHOD_LABELS: Record<OfflineMethod, string> = {
  cash: 'Cash',
  upi: 'GPay / UPI',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  other: 'Other',
}
