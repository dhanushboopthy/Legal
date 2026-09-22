import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { mergeMessages, type OutgoingMessage } from '@/features/chat/thread-model'
import { useRealtime } from '@/hooks/realtime-context'
import { putToStorage } from '@/lib/api/documents'
import { listMessages, markRead, requestAttachmentUrls, sendMessage } from '@/lib/api/messages'
import { getErrorMessage } from '@/lib/errors'
import { contentTypeFor, runPool } from '@/lib/uploads'
import type { MessageOut, UploadRules } from '@/types/api'

const PAGE = 30
const POLL_MS = 3_000 // while the socket is down
const SAFETY_POLL_MS = 30_000 // while it is up: catches anything a dropped event missed
const POLL_PAGE = 100

export interface ThreadData {
  messages: MessageOut[] // oldest first
  hasOlder: boolean
  myLastReadId: number
  otherLastReadId: number
  open: boolean
  // Where the reader had got to when the thread was opened. Never updated, so
  // the "new messages" divider stays put while they read.
  firstLoadCursor: number
}

const newClientId = () => crypto.randomUUID()

/**
 * One case's chat: what has been said, what this browser is still sending, and
 * how both stay current.
 *
 * Fetching is incremental: the first load takes the newest page, and every
 * refresh after that asks only for messages newer than the last one held. It is
 * refreshed by the socket when there is one (see use-realtime) and by polling
 * either way, every 3 s while the socket is down and every 30 s while it is up.
 *
 * Sending is optimistic and idempotent: the message appears at once, carries a
 * `client_id` made here, and a retry re-sends that same id, so however many
 * times it is tried the server posts it once.
 */
export function useThread({ caseId, rules }: { caseId: string; rules: UploadRules }) {
  const queryClient = useQueryClient()
  const { connected } = useRealtime()
  const key = useMemo(() => ['thread', caseId], [caseId])

  const query = useQuery({
    queryKey: key,
    // Dropped when the thread is closed, so reopening starts from the server's
    // idea of what has been read rather than a stale divider.
    gcTime: 0,
    refetchInterval: connected ? SAFETY_POLL_MS : POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<ThreadData> => {
      const held = queryClient.getQueryData<ThreadData>(key)
      if (!held) {
        const first = await listMessages(caseId, { limit: PAGE })
        return {
          messages: first.messages,
          hasOlder: first.has_more,
          myLastReadId: first.my_last_read_id,
          otherLastReadId: first.other_last_read_id,
          open: first.open,
          firstLoadCursor: first.my_last_read_id,
        }
      }
      let messages = held.messages
      let last = await listMessages(caseId, { after: messages.at(-1)?.id ?? 0, limit: POLL_PAGE })
      messages = mergeMessages(messages, last.messages)
      while (last.messages.length === POLL_PAGE) {
        last = await listMessages(caseId, { after: messages.at(-1)?.id ?? 0, limit: POLL_PAGE })
        messages = mergeMessages(messages, last.messages)
      }
      return {
        ...held,
        messages,
        myLastReadId: Math.max(held.myLastReadId, last.my_last_read_id),
        otherLastReadId: Math.max(held.otherLastReadId, last.other_last_read_id),
        open: last.open,
      }
    },
  })

  const patchData = useCallback(
    (fn: (data: ThreadData) => ThreadData) =>
      queryClient.setQueryData<ThreadData>(key, (data) => (data ? fn(data) : data)),
    [queryClient, key],
  )

  // --- older history ----------------------------------------------------------
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadOlder = useCallback(async () => {
    const first = queryClient.getQueryData<ThreadData>(key)?.messages[0]
    if (!first || loadingOlder) return
    setLoadingOlder(true)
    try {
      const older = await listMessages(caseId, { before: first.id, limit: PAGE })
      patchData((data) => ({
        ...data,
        messages: mergeMessages(older.messages, data.messages),
        hasOlder: older.has_more,
      }))
    } finally {
      setLoadingOlder(false)
    }
  }, [caseId, key, loadingOlder, patchData, queryClient])

  // --- sending ----------------------------------------------------------------
  const [outbox, setOutbox] = useState<OutgoingMessage[]>([])
  const outboxRef = useRef<OutgoingMessage[]>([])
  const changeOutbox = useCallback((fn: (all: OutgoingMessage[]) => OutgoingMessage[]) => {
    outboxRef.current = fn(outboxRef.current)
    setOutbox(outboxRef.current)
  }, [])
  const patchEntry = useCallback(
    (clientId: string, changes: Partial<OutgoingMessage>) =>
      changeOutbox((all) => all.map((o) => (o.clientId === clientId ? { ...o, ...changes } : o))),
    [changeOutbox],
  )

  const deliver = useCallback(
    async (clientId: string) => {
      const entry = outboxRef.current.find((o) => o.clientId === clientId)
      if (!entry) return
      patchEntry(clientId, { status: 'sending', error: undefined, offline: false })
      try {
        let attachments = entry.uploaded
        if (!attachments && entry.files.length > 0) {
          const targets = await requestAttachmentUrls(
            caseId,
            entry.files.map((f) => ({
              filename: f.name,
              content_type: contentTypeFor(f.name, rules) ?? '',
              size: f.size,
            })),
          )
          const jobs = entry.files.map((file, i) => ({ file, target: targets[i] }))
          let failure: unknown = null
          await runPool(jobs, 3, async ({ file, target }) => {
            try {
              if (!target) throw new Error('The server did not return an upload link.')
              await putToStorage(target, file, () => {})
            } catch (err) {
              failure ??= err
            }
          })
          if (failure) throw failure
          attachments = targets.map((t) => ({
            storage_key: t.storage_key,
            original_filename: t.filename,
          }))
          // Remember them: if only the send fails, a retry won't upload again.
          patchEntry(clientId, { uploaded: attachments })
        }
        const message = await sendMessage(caseId, {
          client_id: clientId,
          body: entry.body || undefined,
          attachments,
        })
        patchData((data) => ({ ...data, messages: mergeMessages(data.messages, [message]) }))
        changeOutbox((all) => all.filter((o) => o.clientId !== clientId))
        void queryClient.invalidateQueries({ queryKey: ['cases'] })
      } catch (err) {
        patchEntry(clientId, {
          status: 'failed',
          error: getErrorMessage(err, "Couldn't send this message."),
          // No response at all means the connection, not the server, said no.
          offline: isAxiosError(err) && !err.response,
        })
      }
    },
    [caseId, changeOutbox, patchData, patchEntry, queryClient, rules],
  )

  const send = useCallback(
    (body: string, files: File[]) => {
      const clientId = newClientId()
      changeOutbox((all) => [
        ...all,
        { clientId, body, files, status: 'sending', createdAt: new Date().toISOString() },
      ])
      void deliver(clientId)
    },
    [changeOutbox, deliver],
  )
  const retry = useCallback((clientId: string) => void deliver(clientId), [deliver])
  const discard = useCallback(
    (clientId: string) => changeOutbox((all) => all.filter((o) => o.clientId !== clientId)),
    [changeOutbox],
  )

  // A message that failed for want of a connection is tried once more, by
  // itself, as soon as the connection is back. Same client id, so it can't double.
  useEffect(() => {
    const onOnline = () => {
      for (const entry of outboxRef.current) {
        if (entry.status === 'failed' && entry.offline && !entry.autoRetried) {
          patchEntry(entry.clientId, { autoRetried: true })
          void deliver(entry.clientId)
        }
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [deliver, patchEntry])

  // --- reading ----------------------------------------------------------------
  const markUpTo = useCallback(
    async (messageId: number) => {
      const before = queryClient.getQueryData<ThreadData>(key)?.myLastReadId ?? 0
      if (messageId <= before) return
      patchData((data) => ({ ...data, myLastReadId: messageId })) // now, so this can't loop
      try {
        await markRead(caseId, messageId)
        void queryClient.invalidateQueries({ queryKey: ['cases'] })
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      } catch {
        patchData((data) => ({ ...data, myLastReadId: Math.min(data.myLastReadId, before) }))
      }
    },
    [caseId, key, patchData, queryClient],
  )

  // Anything already delivered (its message is now in the list) needn't show twice.
  const delivered = new Set(query.data?.messages.map((m) => m.client_id).filter(Boolean))
  const pending = outbox.filter((o) => !delivered.has(o.clientId))

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    outbox: pending,
    send,
    retry,
    discard,
    loadOlder,
    loadingOlder,
    markUpTo,
  }
}
