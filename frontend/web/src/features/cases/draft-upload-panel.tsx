import { useMutation } from '@tanstack/react-query'
import { UploadCloud } from 'lucide-react'
import { useRef } from 'react'

import { Card } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast-context'
import { uploadCaseDocument } from '@/lib/api/documents'

export function DraftUploadPanel({
  caseId,
  onUploaded,
}: {
  caseId: string
  onUploaded: () => void
}) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: (file: File) => uploadCaseDocument(caseId, file, 'draft'),
    onSuccess: () => {
      toast({
        variant: 'success',
        title: 'Draft delivered',
        description: 'The junior lawyer has been notified.',
      })
      onUploaded()
    },
    onError: () =>
      toast({ variant: 'error', title: 'Upload failed', description: 'Please try again.' }),
  })

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Deliver the draft filing</h3>
      <p className="text-muted mb-4 text-sm">
        Upload the drafted document for the junior lawyer to review.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) mutate(file)
        }}
      />
      <button
        type="button"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-dashed border-[var(--border)] px-4 py-3 text-left text-sm transition-colors hover:bg-black/[0.02] disabled:opacity-50"
      >
        <UploadCloud className="size-4 text-[var(--fg-muted)]" />
        {isPending ? 'Uploading…' : 'Choose a PDF to upload'}
      </button>
    </Card>
  )
}
