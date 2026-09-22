import { apiClient } from '@/lib/api-client'
import type { UserOut } from '@/types/api'

export async function getMe(): Promise<UserOut> {
  const { data } = await apiClient.get<UserOut>('/users/me')
  return data
}

export interface UpdateMePayload {
  bar_council_id?: string
}

export async function updateMe(payload: UpdateMePayload): Promise<UserOut> {
  const { data } = await apiClient.patch<UserOut>('/users/me', payload)
  return data
}

// A phone number is never set directly — it's texted a code first, and only
// stored once that code is confirmed (see CLAUDE.md).
export async function requestPhoneOtp(phone: string): Promise<void> {
  await apiClient.post('/users/me/phone/otp', { phone })
}

export async function verifyPhoneOtp(phone: string, code: string): Promise<UserOut> {
  const { data } = await apiClient.post<UserOut>('/users/me/phone/verify', { phone, code })
  return data
}

// Everyone: the People page. Pending approvals are just the rows with
// is_active=false, not a separate list to reconcile against this one.
export async function listUsers(): Promise<UserOut[]> {
  const { data } = await apiClient.get<UserOut[]>('/users')
  return data
}

export async function approveUser(userId: string): Promise<UserOut> {
  const { data } = await apiClient.patch<UserOut>(`/users/${userId}/approve`)
  return data
}
