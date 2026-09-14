import { apiClient } from '@/lib/api-client'
import type { UserOut } from '@/types/api'

export interface RegisterPayload {
  full_name: string
  email: string
  password: string
  phone?: string
  bar_council_id?: string
}

export async function register(payload: RegisterPayload): Promise<UserOut> {
  const { data } = await apiClient.post<UserOut>('/auth/register', payload)
  return data
}
