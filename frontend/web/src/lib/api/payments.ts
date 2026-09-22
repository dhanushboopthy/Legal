import { apiClient } from '@/lib/api-client'
import type { PaymentListItem, PaymentOut } from '@/types/api'

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
