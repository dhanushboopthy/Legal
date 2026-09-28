import { AlertCircle, CheckCircle2, FileText, Image, RotateCcw, UploadCloud, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'

import { formatBytes } from '@/lib/uploads'
import { cn } from '@/lib/utils'

// The one place a person adds files: choose or drop several at once. It only
// reports what was picked; checking it, uploading it and showing progress are
// the caller's job (see FileRow below and features/cases/use-case-submission).
export function Dropzone({
  onFiles,
  accept,
  hint,
  disabled = false,
}: {
  onFiles: (files: File[]) => void
  accept: string
  hint: string
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (!disabled) onFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {/* The button below is the accessible control; this input is only what
          it opens, so it stays out of the tab order and the a11y tree. */}
      <input
        ref={inputRef}
        data-testid="file-input"
        type="file"
        multiple
        hidden
        accept={accept}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = '' // so choosing the same file again still fires
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex min-h-32 w-full flex-col items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-dashed px-4 py-6 text-center transition-colors',
          dragging
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
            : 'border-[var(--border-strong)] bg-ink/[0.02] hover:bg-ink/[0.04]',
          disabled && 'opacity-50',
        )}
      >
        <UploadCloud className="size-7 text-[var(--color-accent-ink)]" strokeWidth={1.5} aria-hidden />
        <span className="text-sm font-medium">
          Drop files here or <span className="text-accent-ink">choose files</span>
        </span>
        <span className="text-muted text-label">{hint}</span>
      </button>
    </div>
  )
}

export type FileRowStatus = 'queued' | 'uploading' | 'uploaded' | 'failed'

export function FileRow({
  name,
  size,
  status,
  progress = 0,
  error,
  onRemove,
  onRetry,
  busy = false,
}: {
  name: string
  size: number
  status: FileRowStatus
  progress?: number
  error?: string
  onRemove?: () => void
  onRetry?: () => void
  // While the case is being sent, rows can't be changed.
  busy?: boolean
}) {
  const isImage = /\.(png|jpe?g)$/i.test(name)
  const Icon = isImage ? Image : FileText
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100)

  return (
    <li className="rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Icon className="size-5 shrink-0 text-[var(--fg-muted)]" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{name}</p>
          <p className="text-muted text-caption flex items-center gap-1.5">
            {formatBytes(size)}
            {status === 'uploaded' && (
              <span className="text-success-ink inline-flex items-center gap-1">
                <CheckCircle2 className="size-3.5" aria-hidden /> Uploaded
              </span>
            )}
            {status === 'uploading' && <span>{percent}%</span>}
          </p>
        </div>
        {status === 'failed' && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            aria-label={`Retry ${name}`}
            className="text-accent-ink text-label inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 font-medium hover:bg-ink/[0.04] disabled:opacity-50 sm:min-h-9"
          >
            <RotateCcw className="size-4" aria-hidden /> Retry
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy || status === 'uploading'}
            aria-label={`Remove ${name}`}
            className="inline-flex size-11 items-center justify-center rounded-full text-[var(--fg-muted)] hover:bg-ink/[0.04] disabled:opacity-40 sm:size-9"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {status === 'uploading' && (
        <div
          role="progressbar"
          aria-label={`Uploading ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-2 h-1 overflow-hidden rounded-full bg-ink/[0.06]"
        >
          <div className="h-full bg-[var(--color-accent)]" style={{ width: `${percent}%` }} />
        </div>
      )}
      {status === 'failed' && error && (
        <p role="alert" className="text-danger-ink text-caption mt-1.5 flex items-start gap-1.5">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </li>
  )
}
