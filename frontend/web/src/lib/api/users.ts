import { apiClient } from '@/lib/api-client'
import type { UserOut } from '@/types/api'

export async function getMe(): Promise<UserOut> {
  const { data } = await apiClient.get<UserOut>('/users/me')
  return data
}

export async function listPendingUsers(): Promise<UserOut[]> {
  const { data } = await apiClient.get<UserOut[]>('/users/pending')
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
