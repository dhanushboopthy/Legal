import { useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dropzone, FileRow, type FileRowStatus } from '@/components/ui/dropzone'
import { Field, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast-context'
import { sendQuote } from '@/lib/api/cases'
import { requestDraftUploadUrl } from '@/lib/api/documents'
import { getErrorMessage } from '@/lib/errors'
import { formatCurrency } from '@/lib/utils'
import type { Pricing } from '@/types/api'

interface Props {
  caseId: string
  pricing: Pricing
  open: boolean
  onOpenChange: (open: boolean) => void
  // A second call replaces the draft or price of a still-unpaid quote.
  replacing?: boolean
  onSent: () => void
}

export function QuoteSheet({
  caseId,
  pricing,
  open,
  onOpenChange,
  replacing = false,
  onSent,
}: Props) {
  const { toast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [fileStatus, setFileStatus] = useState<FileRowStatus>('queued')
  const [progress, setProgress] = useState(0)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | undefined>()
  // Set once the form checks out: one confirmation that names the amount.
  const [confirmAmount, setConfirmAmount] = useState<number | null>(null)

  const reset = () => {
    setConfirmAmount(null)
    setFile(null)
    setFileStatus('queued')
    setProgress(0)
    setAmount('')
    setNote('')
    setError(undefined)
  }

  const onFiles = (files: File[]) => {
    const picked = files[0]
    if (!picked) return
    if (!picked.name.toLowerCase().endsWith('.pdf')) {
      setError('The draft must be a PDF file.')
      return
    }
    setError(undefined)
    setFile(picked)
    setFileStatus('queued')
    setProgress(0)
  }

  const submit = useMutation({
    mutationFn: async ({ file, amountInr }: { file: File; amountInr: number }) => {
      setFileStatus('uploading')
      const target = await requestDraftUploadUrl(caseId, file.name)
      await axios.put(target.upload_url, file, {
        headers: { 'Content-Type': 'application/pdf' },
        onUploadProgress: (e) => setProgress(e.total ? e.loaded / e.total : 0),
      })
      setFileStatus('uploaded')
      return sendQuote(caseId, {
        draft: { storage_key: target.storage_key, original_filename: file.name },
        amount_inr: amountInr,
        note: note.trim() || undefined,
      })
    },
    onSuccess: () => {
      toast({
        variant: 'success',
        title: replacing ? 'Quote updated' : 'Draft and quote sent',
        description: replacing
          ? 'The lawyer sees the new draft and drafting charges.'
          : "The lawyer can pay to unlock the draft you've sent.",
      })
      reset()
      onOpenChange(false)
      onSent()
    },
    onError: (err) => {
      setFileStatus(file ? 'failed' : 'queued')
      setError(getErrorMessage(err))
      setConfirmAmount(null)
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      title={replacing ? 'Replace draft or drafting charges' : 'Send draft and quote'}
      description="The lawyer pays this amount to unlock the download."
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium">Draft (PDF)</p>
          {file ? (
            <FileRow
              name={file.name}
              size={file.size}
              status={fileStatus}
              progress={progress}
              busy={submit.isPending}
              onRemove={submit.isPending ? undefined : () => setFile(null)}
            />
          ) : (
            <Dropzone
              onFiles={onFiles}
              accept="application/pdf,.pdf"
              hint="One PDF file"
              disabled={submit.isPending}
            />
          )}
        </div>

        <Field
          id="quote-amount"
          label="Drafting charges"
          hint={`Between ${formatCurrency(pricing.quote_min_inr)} and ${formatCurrency(pricing.quote_max_inr)}`}
        >
          {(control) => (
            <div className="relative">
              <span className="text-muted pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm">
                ₹
              </span>
              <input
                {...control}
                type="number"
                inputMode="numeric"
                min={pricing.quote_min_inr}
                max={pricing.quote_max_inr}
                value={amount}
                disabled={submit.isPending}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="2500"
                className="surface text-lead min-h-12 w-full rounded-[var(--radius-control)] border border-[var(--border-strong)] py-2.5 pr-4 pl-8 text-[var(--fg)] tabular-nums focus:border-[var(--color-accent)]"
              />
            </div>
          )}
        </Field>

        <Field id="quote-note" label="Note for the lawyer (optional)">
          {(control) => (
            <Textarea
              {...control}
              value={note}
              disabled={submit.isPending}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything worth flagging about this draft"
            />
          )}
        </Field>

        {error && (
          <p role="alert" className="text-danger-ink text-label">
            {error}
          </p>
        )}

        {confirmAmount !== null && file ? (
          <div
            role="group"
            aria-label="Confirm"
            className="rounded-[var(--radius-control)] bg-ink/[0.04] p-4"
          >
            <p className="text-sm font-medium">
              {replacing
                ? `Replace the draft and ask the lawyer to pay ${formatCurrency(confirmAmount)}?`
                : `Send this draft and ask the lawyer to pay ${formatCurrency(confirmAmount)}?`}
            </p>
            <p className="text-muted text-label mt-1 break-words">{file.name}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                loading={submit.isPending}
                onClick={() => submit.mutate({ file, amountInr: confirmAmount })}
              >
                {replacing ? 'Yes, replace' : 'Yes, send'}
              </Button>
              <Button
                variant="ghost"
                disabled={submit.isPending}
                onClick={() => setConfirmAmount(null)}
              >
                Go back
              </Button>
            </div>
          </div>
        ) : (
          <Button
            className="w-full"
            disabled={!file || !amount}
            onClick={() => {
              if (!file) return
              const amountInr = Number(amount)
              if (
                !Number.isInteger(amountInr) ||
                amountInr < pricing.quote_min_inr ||
                amountInr > pricing.quote_max_inr
              ) {
                setError(
                  `Enter a whole-rupee amount between ${formatCurrency(pricing.quote_min_inr)} and ${formatCurrency(pricing.quote_max_inr)}.`,
                )
                return
              }
              setError(undefined)
              setConfirmAmount(amountInr)
            }}
          >
            {replacing ? 'Send updated draft and charges' : 'Send draft and quote'}
          </Button>
        )}
      </div>
    </Sheet>
  )
}
