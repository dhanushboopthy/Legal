import axios from 'axios'

import { apiClient } from '@/lib/api-client'
import type { DocumentOut, DocumentType, UploadUrlResponse } from '@/types/api'

export async function requestUploadUrl(
  caseId: string,
  filename: string,
  documentType: DocumentType,
): Promise<UploadUrlResponse> {
  const { data } = await apiClient.post<UploadUrlResponse>('/documents/upload-url', {
    case_id: caseId,
    filename,
    document_type: documentType,
  })
  return data
}

export async function uploadFileToStorage(uploadUrl: string, file: File): Promise<void> {
  // Direct browser -> S3 PUT using the presigned URL; the app server never
  // sees the file bytes, per the storage_service.py convention.
  await axios.put(uploadUrl, file, {
    headers: { 'Content-Type': file.type || 'application/pdf' },
  })
}

export async function confirmUpload(
  caseId: string,
  storageKey: string,
  originalFilename: string,
  documentType: DocumentType,
): Promise<DocumentOut> {
  const { data } = await apiClient.post<DocumentOut>('/documents/confirm', {
    case_id: caseId,
    storage_key: storageKey,
    original_filename: originalFilename,
    document_type: documentType,
  })
  return data
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

export async function uploadCaseDocument(
  caseId: string,
  file: File,
  documentType: DocumentType,
): Promise<DocumentOut> {
  const { upload_url, storage_key } = await requestUploadUrl(caseId, file.name, documentType)
  await uploadFileToStorage(upload_url, file)
  return confirmUpload(caseId, storage_key, file.name, documentType)
}
