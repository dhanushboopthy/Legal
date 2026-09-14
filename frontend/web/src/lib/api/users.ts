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

export async function approveUser(userId: string): Promise<UserOut> {
  const { data } = await apiClient.patch<UserOut>(`/users/${userId}/approve`)
  return data
}
