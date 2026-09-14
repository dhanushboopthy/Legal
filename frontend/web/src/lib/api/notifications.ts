import { apiClient } from '@/lib/api-client'
import type { NotificationOut } from '@/types/api'

export async function listMyNotifications(): Promise<NotificationOut[]> {
  const { data } = await apiClient.get<NotificationOut[]>('/notifications/me')
  return data
}

export async function markNotificationRead(notificationId: string): Promise<NotificationOut> {
  const { data } = await apiClient.patch<NotificationOut>(`/notifications/${notificationId}/read`)
  return data
}
