import axios from 'axios'

import { apiClient } from '@/lib/api-client'
import type { ConfirmBatchResponse, DocumentOut, UploadTarget } from '@/types/api'

export async function requestUploadUrls(
  caseId: string,
  files: { filename: string; content_type: string; size: number }[],
): Promise<UploadTarget[]> {
  const { data } = await apiClient.post<{ files: UploadTarget[] }>('/documents/upload-urls', {
    case_id: caseId,
    files,
  })
  return data.files
}

// Direct browser -> store PUT with the presigned URL; the api never sees the
// bytes. The URL is signed for exactly this content type and size, so both
// must be sent as-is (the store answers 403 to anything else).
export async function putToStorage(
  target: Pick<UploadTarget, 'upload_url' | 'content_type'>,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  await axios.put(target.upload_url, file, {
    headers: { 'Content-Type': target.content_type },
    signal,
    onUploadProgress: (e) => onProgress(e.total ? e.loaded / e.total : e.loaded / file.size),
  })
}

export async function confirmBatch(
  caseId: string,
  files: { storage_key: string; original_filename: string }[],
): Promise<ConfirmBatchResponse> {
  const { data } = await apiClient.post<ConfirmBatchResponse>('/documents/confirm-batch', {
    case_id: caseId,
    files,
  })
  return data
}

export async function deleteDocument(documentId: string): Promise<void> {
  await apiClient.delete(`/documents/${documentId}`)
}

export async function listCaseDocuments(caseId: string): Promise<DocumentOut[]> {
  const { data } = await apiClient.get<DocumentOut[]>(`/documents/case/${caseId}`)
  return data
}

export async function getDownloadUrl(documentId: string): Promise<string> {
  const { data } = await apiClient.get<{ download_url: string; expires_in_seconds: number }>(
    `/documents/${documentId}/download-url`,
  )
  return data.download_url
}
