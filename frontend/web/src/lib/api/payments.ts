import { apiClient } from '@/lib/api-client'
import type { PaymentOut } from '@/types/api'

export async function listPaymentsForCase(caseId: string): Promise<PaymentOut[]> {
  const { data } = await apiClient.get<PaymentOut[]>(`/payments/case/${caseId}`)
  return data
}

export async function listAllPayments(): Promise<PaymentOut[]> {
  const { data } = await apiClient.get<PaymentOut[]>('/payments')
  return data
}

export async function refundPayment(paymentId: string): Promise<PaymentOut> {
  const { data } = await apiClient.post<PaymentOut>(`/payments/${paymentId}/refund`)
  return data
}
