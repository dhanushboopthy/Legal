import { useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dropzone, FileRow, type FileRowStatus } from '@/components/ui/dropzone'
import { useToast } from '@/components/ui/toast-context'
import { uploadRevisedDraft } from '@/lib/api/cases'
import { requestDraftUploadUrl } from '@/lib/api/documents'
import { getErrorMessage } from '@/lib/errors'

// The advocate's move once the lawyer has asked for changes (the reason itself
// is in the chat, as the system line that opened this status). Already paid
// for, so the new version is downloadable the moment it's filed.
export function UploadRevisionPanel({
  caseId,
  onChanged,
}: {
  caseId: string
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<FileRowStatus>('queued')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | undefined>()

  const onFiles = (files: File[]) => {
    const picked = files[0]
    if (!picked) return
    if (!picked.name.toLowerCase().endsWith('.pdf')) {
      setError('The draft must be a PDF file.')
      return
    }
    setError(undefined)
    setFile(picked)
    setStatus('queued')
    setProgress(0)
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) return
      setStatus('uploading')
      const target = await requestDraftUploadUrl(caseId, file.name)
      await axios.put(target.upload_url, file, {
        headers: { 'Content-Type': 'application/pdf' },
        onUploadProgress: (e) => setProgress(e.total ? e.loaded / e.total : 0),
      })
      setStatus('uploaded')
      await uploadRevisedDraft(caseId, { storage_key: target.storage_key, original_filename: file.name })
    },
    onSuccess: () => {
      toast({ variant: 'success', title: 'New version sent', description: 'The lawyer can download it now.' })
      setFile(null)
      onChanged()
    },
    onError: (err) => {
      setStatus(file ? 'failed' : 'queued')
      setError(getErrorMessage(err))
    },
  })

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Upload a new version</h3>
      <p className="text-muted mb-4 text-sm">
        The lawyer's requested changes are in the chat below. This version replaces the draft;
        already paid for, so it's downloadable as soon as it's sent.
      </p>

      {file ? (
        <FileRow
          name={file.name}
          size={file.size}
          status={status}
          progress={progress}
          busy={submit.isPending}
          onRemove={submit.isPending ? undefined : () => setFile(null)}
        />
      ) : (
        <Dropzone onFiles={onFiles} accept="application/pdf,.pdf" hint="One PDF file" disabled={submit.isPending} />
      )}

      {error && (
        <p role="alert" className="text-danger-ink text-label mt-2">
          {error}
        </p>
      )}

      <Button className="mt-3" loading={submit.isPending} disabled={!file} onClick={() => submit.mutate()}>
        <RotateCcw className="size-4" /> Send new version
      </Button>
    </Card>
  )
}
