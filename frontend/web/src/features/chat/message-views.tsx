import { useQuery } from '@tanstack/react-query'
import { AlertCircle, FileText, Image as ImageIcon, Loader2, RotateCcw, Tag } from 'lucide-react'

import { useToast } from '@/components/ui/toast-context'
import { LinkifiedText } from '@/features/chat/linkify'
import type { OutgoingMessage } from '@/features/chat/thread-model'
import { getDownloadUrl } from '@/lib/api/documents'
import { openDocument } from '@/lib/download'
import { getErrorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/uploads'
import { cn, formatCurrency } from '@/lib/utils'
import type { AttachmentOut, MessageOut } from '@/types/api'

const timeOf = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

// --- files ---------------------------------------------------------------------

function useOpenDocument() {
  const { toast } = useToast()
  return async (documentId: string) => {
    try {
      await openDocument(documentId)
    } catch (err) {
      toast({
        variant: 'error',
        title: "Couldn't open the file",
        description: getErrorMessage(err),
      })
    }
  }
}

function AttachmentImage({ attachment, own }: { attachment: AttachmentOut; own: boolean }) {
  const open = useOpenDocument()
  // Download links last 5 minutes on the server; keep this one for 4.
  const { data: url, isError } = useQuery({
    queryKey: ['download-url', attachment.document_id],
    queryFn: () => getDownloadUrl(attachment.document_id),
    staleTime: 4 * 60_000,
  })
  if (isError || !url) return <AttachmentChip attachment={attachment} own={own} />
  return (
    <button
      type="button"
      onClick={() => void open(attachment.document_id)}
      aria-label={`Open ${attachment.filename}`}
      className="block overflow-hidden rounded-[var(--radius-control)]"
    >
      <img
        src={url}
        alt={attachment.filename}
        loading="lazy"
        className="max-h-52 max-w-full object-cover"
      />
    </button>
  )
}

function AttachmentChip({ attachment, own }: { attachment: AttachmentOut; own: boolean }) {
  const open = useOpenDocument()
  const Icon = attachment.content_type?.startsWith('image/') ? ImageIcon : FileText
  return (
    <button
      type="button"
      onClick={() => void open(attachment.document_id)}
      className={cn(
        'text-label flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-left',
        own ? 'bg-white/15 hover:bg-white/25' : 'bg-ink/[0.04] hover:bg-ink/[0.07]',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
      {attachment.size_bytes !== null && (
        <span className="text-caption opacity-80">{formatBytes(attachment.size_bytes)}</span>
      )}
    </button>
  )
}

function Attachments({ items, own }: { items: AttachmentOut[]; own: boolean }) {
  return (
    <ul className="mt-1 space-y-1.5 first:mt-0">
      {items.map((a) => (
        <li key={a.document_id}>
          {a.content_type?.startsWith('image/') ? (
            <AttachmentImage attachment={a} own={own} />
          ) : (
            <AttachmentChip attachment={a} own={own} />
          )}
        </li>
      ))}
    </ul>
  )
}

// --- bubbles -------------------------------------------------------------------

export function Bubble({
  message,
  own,
  startsGroup,
  endsGroup,
}: {
  message: MessageOut
  own: boolean
  startsGroup: boolean
  endsGroup: boolean
}) {
  return (
    <div
      className={cn('flex flex-col', own ? 'items-end' : 'items-start', !startsGroup && '-mt-1')}
    >
      {!own && startsGroup && message.sender_name && (
        <span className="text-muted text-label mb-0.5 px-1 font-semibold">
          {message.sender_name}
        </span>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm break-words',
          own ? 'bg-[var(--color-accent)] text-white' : 'surface border border-[var(--border)]',
          // The tail: the corner beside the sender squares off on the last bubble.
          endsGroup && (own ? 'rounded-br-md' : 'rounded-bl-md'),
        )}
      >
        {message.body && (
          <p className="whitespace-pre-wrap">
            <LinkifiedText text={message.body} />
          </p>
        )}
        {message.attachments.length > 0 && <Attachments items={message.attachments} own={own} />}
      </div>
      {endsGroup && (
        <span className="text-muted text-label mt-0.5 px-1">{timeOf(message.created_at)}</span>
      )}
    </div>
  )
}

export function OutgoingBubble({
  entry,
  endsGroup,
  onRetry,
  onDiscard,
}: {
  entry: OutgoingMessage
  endsGroup: boolean
  onRetry: () => void
  onDiscard: () => void
}) {
  const failed = entry.status === 'failed'
  return (
    <div className="flex flex-col items-end">
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm break-words text-white',
          failed ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-accent)] opacity-70',
          endsGroup && 'rounded-br-md',
        )}
      >
        {entry.body && <p className="whitespace-pre-wrap">{entry.body}</p>}
        {entry.files.length > 0 && (
          <ul className="mt-1 space-y-1 first:mt-0">
            {entry.files.map((f) => (
              <li
                key={`${f.name}-${f.size}`}
                className="text-label flex items-center gap-2 rounded-[var(--radius-control)] bg-white/15 px-3 py-1.5"
              >
                <FileText className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-caption opacity-80">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {failed ? (
        <div
          role="alert"
          className="text-danger-ink text-label mt-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-1 font-semibold"
        >
          <span className="inline-flex items-center gap-1">
            <AlertCircle className="size-3.5" aria-hidden /> Not sent. {entry.error}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-8 items-center gap-1 font-medium underline"
          >
            <RotateCcw className="size-3.5" aria-hidden /> Retry
          </button>
          <button type="button" onClick={onDiscard} className="min-h-8 font-medium underline">
            Remove
          </button>
        </div>
      ) : (
        <span className="text-muted text-label mt-0.5 inline-flex items-center gap-1 px-1">
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />{' '}
          Sending…
        </span>
      )}
    </div>
  )
}

// --- what the server wrote -------------------------------------------------------

export function SystemLine({ message }: { message: MessageOut }) {
  return (
    <p className="text-muted text-caption mx-auto max-w-[90%] text-center whitespace-pre-wrap">
      {message.body}
    </p>
  )
}

const asNumber = (v: unknown) => (typeof v === 'number' ? v : null)
const asString = (v: unknown) => (typeof v === 'string' ? v : null)

interface DraftInfo {
  document_id?: string
  filename?: string
  page_count?: number | null
  size_bytes?: number | null
}

function draftSummary(draft: DraftInfo | undefined): string {
  if (!draft) return ''
  const pages = draft.page_count
    ? `${draft.page_count} ${draft.page_count === 1 ? 'page' : 'pages'}`
    : null
  const size = draft.size_bytes ? formatBytes(draft.size_bytes) : null
  return [draft.filename, pages, size].filter(Boolean).join(' · ')
}

// The draft and its price, as a card in the thread rather than a bubble. It
// says what was sent; paying is done from the case's action card.
export function QuoteCard({ message }: { message: MessageOut }) {
  const amount = asNumber(message.meta.amount_inr)
  const note = asString(message.meta.note)
  const draft = message.meta.draft as DraftInfo | undefined
  return (
    <div className="surface w-full rounded-[var(--radius-card)] border border-[var(--border)] p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
          <Tag className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-muted text-caption">
            {message.meta.updated === true ? 'Drafting charges updated' : 'Drafting charges'}
          </p>
          {amount !== null && <p className="text-lg font-semibold">{formatCurrency(amount)}</p>}
          <p className="text-muted text-label mt-0.5 break-words">{draftSummary(draft)}</p>
          {note && <p className="mt-2 text-sm whitespace-pre-wrap">&ldquo;{note}&rdquo;</p>}
        </div>
      </div>
    </div>
  )
}

// Says a new version arrived. Downloading lives in one place, the case page's
// action card at the top, so this card only points there.
export function DraftCard({ message }: { message: MessageOut }) {
  return (
    <div className="surface w-full rounded-[var(--radius-card)] border border-[var(--border)] p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent-ink)]">
          <FileText className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{message.body ?? 'New draft version'}</p>
          <p className="text-muted text-label mt-0.5 break-words">
            {draftSummary(message.meta as DraftInfo)}
          </p>
          <p className="text-muted text-label mt-1">
            Download it from the case: tap Open case, above.
          </p>
        </div>
      </div>
    </div>
  )
}
