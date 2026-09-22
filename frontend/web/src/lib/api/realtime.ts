import { apiClient } from '@/lib/api-client'

// A single-use ticket, valid for 30 seconds, for opening the event socket: a
// browser can't send an Authorization header on a WebSocket.
export async function getSocketTicket(): Promise<string> {
  const { data } = await apiClient.post<{ ticket: string; expires_in_seconds: number }>(
    '/ws/ticket',
  )
  return data.ticket
}
