import { apiClient } from '@/lib/api-client'
import type { MessageOut, MessagePage, UploadTarget } from '@/types/api'

export interface ListMessagesParams {
  before?: number
  after?: number
  limit?: number
}

export async function listMessages(
  caseId: string,
  params: ListMessagesParams = {},
): Promise<MessagePage> {
  const { data } = await apiClient.get<MessagePage>(`/cases/${caseId}/messages`, { params })
  return data
}

export interface SendMessagePayload {
  // Made once per message by the browser: sending it again is a retry, never a duplicate.
  client_id: string
  body?: string
  attachments?: { storage_key: string; original_filename: string }[]
}

export async function sendMessage(
  caseId: string,
  payload: SendMessagePayload,
): Promise<MessageOut> {
  const { data } = await apiClient.post<MessageOut>(`/cases/${caseId}/messages`, payload)
  return data
}

export async function markRead(caseId: string, lastReadMessageId: number): Promise<void> {
  await apiClient.post(`/cases/${caseId}/read`, { last_read_message_id: lastReadMessageId })
}

export async function requestAttachmentUrls(
  caseId: string,
  files: { filename: string; content_type: string; size: number }[],
): Promise<UploadTarget[]> {
  const { data } = await apiClient.post<{ files: UploadTarget[] }>(
    `/cases/${caseId}/attachments/upload-urls`,
    { files },
  )
  return data.files
}
