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

// Profile picture: sign a PUT, upload straight to storage, then confirm (the
// server checks the file before using it).
export async function uploadAvatar(picture: Blob): Promise<UserOut> {
  const { data: target } = await apiClient.post<{ key: string; url: string }>(
    '/users/me/avatar/upload-url',
    { content_type: picture.type, size: picture.size },
  )
  const put = await fetch(target.url, {
    method: 'PUT',
    body: picture,
    headers: { 'Content-Type': picture.type },
  })
  if (!put.ok) throw new Error("The picture couldn't be uploaded. Please try again.")
  const { data } = await apiClient.put<UserOut>('/users/me/avatar', { key: target.key })
  return data
}

export async function removeAvatar(): Promise<UserOut> {
  const { data } = await apiClient.delete<UserOut>('/users/me/avatar')
  return data
}

// Everyone: the People page. Pending approvals are just the rows with
// is_active=false, not a separate list to reconcile against this one.
export async function listUsers(): Promise<UserOut[]> {
  const { data } = await apiClient.get<UserOut[]>('/users')
  return data
}

// Take someone off the service (signed out everywhere, can't sign in) and
// bring them back later. Nothing of theirs is deleted.
export async function removeUser(userId: string): Promise<UserOut> {
  const { data } = await apiClient.patch<UserOut>(`/users/${userId}/remove`)
  return data
}

export async function restoreUser(userId: string): Promise<UserOut> {
  const { data } = await apiClient.patch<UserOut>(`/users/${userId}/restore`)
  return data
}

export async function approveUser(userId: string): Promise<UserOut> {
  const { data } = await apiClient.patch<UserOut>(`/users/${userId}/approve`)
  return data
}
