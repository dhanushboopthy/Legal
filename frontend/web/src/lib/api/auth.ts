import { apiClient } from '@/lib/api-client'
import type { UserOut } from '@/types/api'

export interface RegisterPayload {
  full_name: string
  email: string
  password: string
  bar_council_id?: string
}

export async function register(payload: RegisterPayload): Promise<UserOut> {
  const { data } = await apiClient.post<UserOut>('/auth/register', payload)
  return data
}

// Verifying the code itself signs the account in (a Token, not a UserOut) —
// that goes through the BFF as useAuth().verifyEmail, not through here.

// Always succeeds (204) whether or not the email has an account.
export async function forgotPassword(email: string): Promise<void> {
  await apiClient.post('/auth/forgot-password', { email })
}

export async function resendOtp(email: string): Promise<void> {
  await apiClient.post('/auth/resend-otp', { email })
}
