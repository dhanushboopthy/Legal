import { isAxiosError } from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { FileRowStatus } from '@/components/ui/dropzone'
import {
  createCase,
  getCase,
  submitCase,
  updateCase,
  type CreateCasePayload,
} from '@/lib/api/cases'
import { confirmBatch, deleteDocument, putToStorage, requestUploadUrls } from '@/lib/api/documents'
import { getErrorMessage } from '@/lib/errors'
import { contentTypeFor, runPool, validateSelection, type Rejection } from '@/lib/uploads'
import type { DocumentOut, UploadRules, UploadTarget } from '@/types/api'

const PARALLEL_UPLOADS = 3

export interface UploadRow {
  id: string
  name: string
  size: number
  status: FileRowStatus
  progress: number
  error?: string
  // Kept only until the file is safely on the server.
  file?: File
  documentId?: string
}

export type Phase = 'idle' | 'saving' | 'uploading' | 'submitting' | 'paying'

let rowSeq = 0
const newRowId = () => `row-${++rowSeq}`

function rowsFromDocuments(documents: DocumentOut[]): UploadRow[] {
  return documents
    .filter((d) => d.type === 'original')
    .map((d) => ({
      id: newRowId(),
      name: d.original_filename,
      size: d.size_bytes ?? 0,
      status: 'uploaded' as const,
      progress: 1,
      documentId: d.id,
    }))
}

function uploadError(err: unknown): string {
  if (isAxiosError(err) && err.response?.status === 403) {
    return 'The upload link expired or was refused. Try again.'
  }
  if (isAxiosError(err) && !err.response) {
    return 'The upload was interrupted. Check your connection and try again.'
  }
  return getErrorMessage(err, 'The upload failed. Try again.')
}

/**
 * Everything between "I chose some files" and "the review fee checkout is
 * open": create the case as a draft, upload each file straight to storage
 * (3 at a time), have the server verify them, submit the case, then hand over
 * to payment.
 *
 * Every step is resumable. The draft's id is kept, so a failed upload retries
 * against the same case and never creates a second one; a file that is
 * already confirmed is never uploaded again; only failed files are retried.
 */
export function useCaseSubmission({
  rules,
  initial,
  onSubmitted,
}: {
  rules: UploadRules
  // An unfinished draft to continue: its confirmed files show as uploaded.
  // Read once, on the first render.
  initial?: { caseId: string; documents: DocumentOut[] } | null
  // Called once the case is submitted. It must take the person somewhere
  // (checkout, or the case page): after this the form can't submit again.
  onSubmitted: (caseId: string) => Promise<void>
}) {
  // Rows live in a ref as well as state so the async flow always reads the
  // latest, not the snapshot from when it started.
  const [rows, setRowsState] = useState<UploadRow[]>(() =>
    initial ? rowsFromDocuments(initial.documents) : [],
  )
  const rowsRef = useRef<UploadRow[]>(rows)
  const [phase, setPhase] = useState<Phase>('idle')
  const [stepError, setStepError] = useState<string | null>(null)
  const caseIdRef = useRef<string | null>(initial?.caseId ?? null)
  const controllers = useRef(new Set<AbortController>())

  const setRows = useCallback((fn: (rows: UploadRow[]) => UploadRow[]) => {
    rowsRef.current = fn(rowsRef.current)
    setRowsState(rowsRef.current)
  }, [])
  const patch = useCallback(
    (id: string, changes: Partial<UploadRow>) =>
      setRows((all) => all.map((r) => (r.id === id ? { ...r, ...changes } : r))),
    [setRows],
  )

  // Leaving the page stops in-flight uploads; the draft stays for later.
  useEffect(() => {
    const live = controllers.current
    return () => {
      live.forEach((c) => c.abort())
      live.clear()
    }
  }, [])

  const addFiles = useCallback(
    (files: File[]): { added: File[]; rejected: Rejection[] } => {
      const current = rowsRef.current
      const { accepted, rejected } = validateSelection(
        files,
        { count: current.length, bytes: current.reduce((sum, r) => sum + r.size, 0) },
        current,
        rules,
      )
      setRows((all) => [
        ...all,
        ...accepted.map((file): UploadRow => ({
          id: newRowId(),
          name: file.name,
          size: file.size,
          status: 'queued',
          progress: 0,
          file,
        })),
      ])
      return { added: accepted, rejected }
    },
    [rules, setRows],
  )

  const reset = useCallback(() => {
    caseIdRef.current = null
    setRows(() => [])
    setStepError(null)
    setPhase('idle')
  }, [setRows])

  const removeRow = useCallback(
    async (id: string) => {
      const row = rowsRef.current.find((r) => r.id === id)
      if (!row) return
      // A file already on the server has to be deleted there first; if that
      // fails the row stays and the caller reports why.
      if (row.documentId) await deleteDocument(row.documentId)
      setRows((all) => all.filter((r) => r.id !== id))
    },
    [setRows],
  )

  /** Upload and confirm the given rows. Records each file's outcome on its row. */
  const uploadRows = useCallback(
    async (caseId: string, ids: string[]) => {
      const todo = ids
        .map((id) => rowsRef.current.find((r) => r.id === id))
        .filter((r): r is UploadRow & { file: File } => !!r?.file)
      if (todo.length === 0) return
      const controller = new AbortController()
      controllers.current.add(controller)

      todo.forEach((r) => patch(r.id, { status: 'uploading', progress: 0, error: undefined }))
      const failAll = (message: string) =>
        todo.forEach((r) => patch(r.id, { status: 'failed', error: message }))

      try {
        // One request signs every file; the type and size are signed in.
        let targets
        try {
          targets = await requestUploadUrls(
            caseId,
            todo.map((r) => ({
              filename: r.name,
              content_type: contentTypeFor(r.name, rules) ?? '',
              size: r.file.size,
            })),
          )
        } catch (err) {
          failAll(getErrorMessage(err))
          return
        }

        const uploaded: { row: UploadRow; storageKey: string }[] = []
        const jobs: { row: UploadRow & { file: File }; target: UploadTarget }[] = []
        todo.forEach((row, i) => {
          const target = targets[i]
          if (target) jobs.push({ row, target })
          else
            patch(row.id, { status: 'failed', error: 'The server did not return an upload link.' })
        })
        await runPool(jobs, PARALLEL_UPLOADS, async ({ row, target }) => {
          try {
            await putToStorage(
              target,
              row.file,
              (fraction) => patch(row.id, { progress: fraction }),
              controller.signal,
            )
            uploaded.push({ row, storageKey: target.storage_key })
          } catch (err) {
            if (controller.signal.aborted) return
            patch(row.id, { status: 'failed', error: uploadError(err) })
          }
        })
        if (controller.signal.aborted || uploaded.length === 0) return

        try {
          const result = await confirmBatch(
            caseId,
            uploaded.map((u) => ({ storage_key: u.storageKey, original_filename: u.row.name })),
          )
          const rejected = new Map(result.rejected.map((r) => [r.storage_key, r.reason]))
          for (const { row, storageKey } of uploaded) {
            const reason = rejected.get(storageKey)
            const doc = result.confirmed.find(
              (d) => d.original_filename === row.name && d.size_bytes === row.size,
            )
            if (reason) patch(row.id, { status: 'failed', error: reason })
            else if (doc) {
              patch(row.id, {
                status: 'uploaded',
                progress: 1,
                documentId: doc.id,
                file: undefined,
                error: undefined,
              })
            } else patch(row.id, { status: 'failed', error: 'We could not confirm this file.' })
          }
        } catch (err) {
          for (const { row } of uploaded) {
            patch(row.id, { status: 'failed', error: getErrorMessage(err) })
          }
        }
      } finally {
        controllers.current.delete(controller)
      }
    },
    [patch, rules],
  )

  const retryRow = useCallback(
    async (id: string) => {
      const caseId = caseIdRef.current
      if (caseId) await uploadRows(caseId, [id])
    },
    [uploadRows],
  )

  const submit = useCallback(
    async (details: CreateCasePayload) => {
      if (phase !== 'idle') return
      setStepError(null)
      setPhase('saving')
      try {
        // 1. The case. A retry, or a resumed draft, keeps the same case.
        let caseId = caseIdRef.current
        if (caseId) {
          try {
            await updateCase(caseId, details)
          } catch (err) {
            // The last attempt may have got as far as submitting before its
            // response was lost. If so, carry on to payment instead of failing.
            if (isAxiosError(err) && err.response?.status === 409) {
              if ((await getCase(caseId)).status === 'submitted') {
                setPhase('paying')
                await onSubmitted(caseId)
                return
              }
            }
            throw err
          }
        } else {
          caseId = (await createCase(details)).id
          caseIdRef.current = caseId
        }

        // 2. The files that aren't on the server yet.
        const pending = rowsRef.current.filter((r) => r.file).map((r) => r.id)
        if (pending.length > 0) {
          setPhase('uploading')
          await uploadRows(caseId, pending)
        }
        if (rowsRef.current.some((r) => r.status !== 'uploaded')) {
          setPhase('idle')
          return // failures are on their rows; the button retries them
        }

        // 3. Submit, then hand over. Past this point the case is submitted, so
        //    whatever happens next must leave this form.
        setPhase('submitting')
        await submitCase(caseId)
        setPhase('paying')
        await onSubmitted(caseId)
      } catch (err) {
        setStepError(getErrorMessage(err))
        setPhase('idle')
      }
    },
    [onSubmitted, phase, uploadRows],
  )

  return {
    rows,
    phase,
    stepError,
    addFiles,
    removeRow,
    retryRow,
    reset,
    submit,
  }
}
