import { Paperclip, Send, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

import { useToast } from '@/components/ui/toast-context'
import { formatBytes, validateSelection } from '@/lib/uploads'
import type { UploadRules } from '@/types/api'

export const MAX_BODY = 4000
const COUNTER_FROM = 3500
export const MAX_ATTACHMENTS = 5
const MAX_LINES = 4

// Where Enter sends. On a phone (no hover, coarse pointer) Enter is a new line
// and the Send button sends; on a desktop Enter sends and Shift+Enter is a new line.
const enterSends = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches

export function Composer({
  rules,
  onSend,
}: {
  rules: UploadRules
  onSend: (body: string, files: File[]) => void
}) {
  const { toast } = useToast()
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const textarea = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  // Grow with the text, up to four lines, then scroll inside.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_LINES + 16)}px`
  }, [body])

  const canSend = body.trim().length > 0 || files.length > 0

  const submit = () => {
    if (!canSend) return
    onSend(body.trim(), files)
    setBody('')
    setFiles([])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterSends()) {
      e.preventDefault()
      submit()
    }
  }

  const addFiles = (picked: File[]) => {
    const chatRules = { ...rules, max_files: MAX_ATTACHMENTS }
    const { accepted, rejected } = validateSelection(
      picked,
      { count: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) },
      files,
      chatRules,
    )
    if (accepted.length > 0) setFiles((all) => [...all, ...accepted])
    if (rejected.length > 0) {
      toast({
        variant: 'error',
        title: "Some files weren't added",
        description: rejected.map((r) => `"${r.name}" ${r.reason}`).join(' '),
      })
    }
  }

  return (
    <div className="border-t border-[var(--border)] p-3">
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Files to send">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}`}
              className="text-label flex max-w-full items-center gap-1.5 rounded-full bg-black/[0.05] py-1 pr-1 pl-3"
            >
              <span className="max-w-40 truncate">{file.name}</span>
              <span className="text-muted text-caption">{formatBytes(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((all) => all.filter((f) => f !== file))}
                className="inline-flex size-7 items-center justify-center rounded-full hover:bg-black/[0.08]"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={picker}
          data-testid="chat-file-input"
          type="file"
          multiple
          hidden
          accept={Object.keys(rules.accepted).join(',')}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <button
          type="button"
          aria-label="Attach files"
          disabled={files.length >= MAX_ATTACHMENTS}
          onClick={() => picker.current?.click()}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--fg-muted)] hover:bg-black/[0.05] disabled:opacity-40"
        >
          <Paperclip className="size-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <textarea
            ref={textarea}
            aria-label="Message"
            rows={1}
            value={body}
            maxLength={MAX_BODY}
            placeholder="Message"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            className="surface text-lead block max-h-32 w-full resize-none rounded-[var(--radius-control)] border border-[var(--border)] px-3.5 py-2 outline-none placeholder:text-[var(--fg-muted)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/40"
          />
          {body.length >= COUNTER_FROM && (
            <p className="text-muted text-caption mt-1 text-right" aria-live="polite">
              {body.length.toLocaleString('en-IN')} / {MAX_BODY.toLocaleString('en-IN')}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Send message"
          disabled={!canSend}
          onClick={submit}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
        >
          <Send className="size-[18px]" aria-hidden />
        </button>
      </div>
    </div>
  )
}
