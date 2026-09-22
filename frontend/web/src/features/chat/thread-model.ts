import type { MessageOut } from '@/types/api'

// Pure helpers for laying a thread out: which messages group together, where
// the day separators and the "new messages" divider go. No React in here so the
// rules can be tested directly.

export const GROUP_WITHIN_MS = 5 * 60 * 1000

// A message that is on its way from this browser (or failed to leave it).
export interface OutgoingMessage {
  clientId: string
  body: string
  files: File[]
  status: 'sending' | 'failed'
  error?: string
  // Set once the files are safely uploaded, so a retry doesn't upload them again.
  uploaded?: { storage_key: string; original_filename: string }[]
  // Failed for lack of a connection (worth one automatic retry when it returns).
  offline?: boolean
  autoRetried?: boolean
  createdAt: string
}

export type ThreadItem =
  | { type: 'day'; key: string; label: string }
  | { type: 'unread'; key: string }
  | {
      type: 'message'
      key: string
      message: MessageOut | null
      outgoing: OutgoingMessage | null
      own: boolean
      // First and last of a run from one sender: spacing and the bubble tail.
      startsGroup: boolean
      endsGroup: boolean
    }

export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  }).format(date)
}

const dayKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// System lines and cards belong to nobody, so they never join a bubble group.
const isBubble = (m: MessageOut) => m.kind === 'text' || m.kind === 'file'

export function buildThread({
  messages,
  outgoing,
  ownId,
  unreadAfterId,
  now = new Date(),
}: {
  messages: MessageOut[]
  outgoing: OutgoingMessage[]
  ownId: string
  // Messages from others after this id are "new": the divider goes before the
  // first of them. Null for no divider.
  unreadAfterId: number | null
  now?: Date
}): ThreadItem[] {
  const entries: { at: string; message: MessageOut | null; outgoing: OutgoingMessage | null }[] = [
    ...messages.map((message) => ({ at: message.created_at, message, outgoing: null })),
    ...outgoing.map((o) => ({ at: o.createdAt, message: null, outgoing: o })),
  ]

  const items: ThreadItem[] = []
  let previousDay: string | null = null
  let dividerPlaced = unreadAfterId === null

  entries.forEach((entry, i) => {
    const day = dayKey(entry.at)
    if (day !== previousDay) {
      items.push({ type: 'day', key: `day-${day}`, label: dayLabel(entry.at, now) })
      previousDay = day
    }

    const message = entry.message
    if (
      !dividerPlaced &&
      message &&
      message.id > (unreadAfterId ?? 0) &&
      message.sender_id !== ownId
    ) {
      items.push({ type: 'unread', key: 'unread' })
      dividerPlaced = true
    }

    const senderOf = (e: (typeof entries)[number]) =>
      e.outgoing ? ownId : (e.message?.sender_id ?? null)
    const bubbleOf = (e: (typeof entries)[number]) => (e.message ? isBubble(e.message) : true)
    const joins = (a: (typeof entries)[number], b: (typeof entries)[number]) =>
      bubbleOf(a) &&
      bubbleOf(b) &&
      senderOf(a) !== null &&
      senderOf(a) === senderOf(b) &&
      dayKey(a.at) === dayKey(b.at) &&
      new Date(b.at).getTime() - new Date(a.at).getTime() <= GROUP_WITHIN_MS

    const prev = entries[i - 1]
    const next = entries[i + 1]
    items.push({
      type: 'message',
      key: entry.outgoing ? `out-${entry.outgoing.clientId}` : `msg-${message?.id}`,
      message,
      outgoing: entry.outgoing,
      own: entry.outgoing ? true : message?.sender_id === ownId,
      startsGroup: !(prev && joins(prev, entry)),
      endsGroup: !(next && joins(entry, next)),
    })
  })
  return items
}

/** Merge newly fetched messages into what is already held: by id, oldest first, no repeats. */
export function mergeMessages(held: MessageOut[], incoming: MessageOut[]): MessageOut[] {
  const byId = new Map<number, MessageOut>()
  for (const m of held) byId.set(m.id, m)
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** The id of the newest of the viewer's own messages, for the "Seen" mark. */
export function lastOwnMessageId(messages: MessageOut[], ownId: string): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.sender_id === ownId && isBubble(m)) return m.id
  }
  return null
}
