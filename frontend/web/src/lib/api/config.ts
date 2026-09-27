import { apiClient } from '@/lib/api-client'
import type { Pricing, SupportContact, UploadRules } from '@/types/api'

// Fees and limits live on the server; the UI never hard-codes them.
export async function getPricing(): Promise<Pricing> {
  const { data } = await apiClient.get<Pricing>('/config/pricing')
  return data
}

export async function getSupport(): Promise<SupportContact> {
  const { data } = await apiClient.get<SupportContact>('/config/support')
  return data
}

export async function getUploadRules(): Promise<UploadRules> {
  const { data } = await apiClient.get<UploadRules>('/config/uploads')
  return data
}
