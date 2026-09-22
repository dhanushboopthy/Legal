import { useQuery } from '@tanstack/react-query'
import { ArrowDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast-context'
import { Composer } from '@/features/chat/composer'
import {
  Bubble,
  DraftCard,
  OutgoingBubble,
  QuoteCard,
  SystemLine,
} from '@/features/chat/message-views'
import { buildThread, lastOwnMessageId } from '@/features/chat/thread-model'
import { useThread } from '@/features/chat/use-thread'
import { getUploadRules } from '@/lib/api/config'
import { getErrorMessage } from '@/lib/errors'
import type { UploadRules } from '@/types/api'

const NEAR_BOTTOM_PX = 80

const subscribeVisibility = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify)
  return () => document.removeEventListener('visibilitychange', notify)
}
const isTabVisible = () => document.visibilityState === 'visible'

// On a phone the keyboard shrinks the *visual* viewport but not the layout one,
// so a fixed-height chat would slide under it. Follow the visual viewport.
function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setHeight(viewport.height)
    update()
    viewport.addEventListener('resize', update)
    return () => viewport.removeEventListener('resize', update)
  }, [])
  return height
}

export function ChatThread({ caseId, ownId }: { caseId: string; ownId: string }) {
  const rules = useQuery({
    queryKey: ['upload-rules'],
    queryFn: getUploadRules,
    staleTime: Infinity,
  })
  if (rules.isError) {
    return (
      <ErrorState
        error={rules.error}
        title="Couldn't load the chat"
        onRetry={() => void rules.refetch()}
      />
    )
  }
  if (!rules.data) return <ChatSkeleton />
  return <ChatBody caseId={caseId} ownId={ownId} rules={rules.data} />
}

function ChatSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading chat">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="ml-auto h-10 w-1/2" />
      <Skeleton className="h-10 w-3/5" />
    </div>
  )
}

function ChatBody({ caseId, ownId, rules }: { caseId: string; ownId: string; rules: UploadRules }) {
  const { toast } = useToast()
  const thread = useThread({ caseId, rules })
  const { data } = thread
  const visible = useSyncExternalStore(subscribeVisibility, isTabVisible, () => true)
  const viewportHeight = useVisualViewportHeight()

  const listRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [newBelow, setNewBelow] = useState(0)
  const startedAtBottom = useRef(true)
  const scrolledToStart = useRef(false)
  const shown = useRef(0)
  const olderAnchor = useRef<number | null>(null)

  const items = useMemo(
    () =>
      data
        ? buildThread({
            messages: data.messages,
            outgoing: thread.outbox,
            ownId,
            unreadAfterId: data.firstLoadCursor,
          })
        : [],
    [data, thread.outbox, ownId],
  )

  // --- scrolling ----------------------------------------------------------------
  const toBottom = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !data) return
    if (olderAnchor.current !== null) {
      // Older history was added above: keep what the reader was looking at in place.
      el.scrollTop = el.scrollHeight - olderAnchor.current
      olderAnchor.current = null
      shown.current = items.length
      return
    }
    if (!scrolledToStart.current) {
      // First paint: land on the first unread message, else the latest.
      const divider = el.querySelector<HTMLElement>('[data-unread-divider]')
      if (divider) el.scrollTop = Math.max(0, divider.offsetTop - 8)
      else toBottom()
      scrolledToStart.current = true
      shown.current = items.length
      startedAtBottom.current = !divider
      setAtBottom(!divider && true)
      return
    }
    const added = items.length - shown.current
    shown.current = items.length
    if (added <= 0) return
    if (atBottom) toBottom()
    else setNewBelow((n) => n + added)
  }, [items, data, atBottom])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    setAtBottom(near)
    if (near) setNewBelow(0)
  }

  // --- reading --------------------------------------------------------------------
  const newestId = data?.messages.at(-1)?.id ?? 0
  const myLastReadId = data?.myLastReadId ?? 0
  const { markUpTo } = thread
  useEffect(() => {
    // Read means: the tab is in front and the reader is at the latest message.
    if (visible && atBottom && newestId > myLastReadId) void markUpTo(newestId)
  }, [visible, atBottom, newestId, myLastReadId, markUpTo])

  const loadEarlier = async () => {
    const el = listRef.current
    if (el) olderAnchor.current = el.scrollHeight - el.scrollTop
    try {
      await thread.loadOlder()
    } catch (err) {
      olderAnchor.current = null
      toast({
        variant: 'error',
        title: "Couldn't load earlier messages",
        description: getErrorMessage(err),
      })
    }
  }

  // --- states -----------------------------------------------------------------------
  if (thread.error && !data) {
    return (
      <ErrorState
        error={thread.error}
        title="Couldn't load the chat"
        onRetry={() => void thread.refetch()}
      />
    )
  }
  if (!data) return <ChatSkeleton />

  const lastOwn = lastOwnMessageId(data.messages, ownId)
  const seen = lastOwn !== null && data.otherLastReadId >= lastOwn
  const empty = data.messages.length === 0 && thread.outbox.length === 0

  return (
    <section
      aria-label="Case chat"
      className="surface shadow-card relative flex min-h-[420px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]"
      style={{
        height: viewportHeight ? `min(70dvh, ${Math.max(360, viewportHeight - 24)}px)` : '70dvh',
      }}
    >
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-base font-semibold">Chat</h2>
      </div>

      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-3"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Messages"
      >
        {data.hasOlder && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={thread.loadingOlder}
              className="text-accent-ink text-label min-h-9 font-medium underline disabled:opacity-50"
            >
              {thread.loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {empty && (
          <p className="text-muted py-10 text-center text-sm">
            No messages yet. Say hello to start the conversation.
          </p>
        )}
        {items.map((item) => {
          if (item.type === 'day') {
            return (
              <p key={item.key} className="text-muted text-caption pt-2 text-center font-medium">
                {item.label}
              </p>
            )
          }
          if (item.type === 'unread') {
            return (
              <div
                key={item.key}
                data-unread-divider
                role="separator"
                aria-label="New messages"
                className="text-accent-ink text-caption flex items-center gap-3 py-1 font-medium"
              >
                <span className="h-px flex-1 bg-current opacity-30" />
                New messages
                <span className="h-px flex-1 bg-current opacity-30" />
              </div>
            )
          }
          if (item.outgoing) {
            return (
              <OutgoingBubble
                key={item.key}
                entry={item.outgoing}
                endsGroup={item.endsGroup}
                onRetry={() => thread.retry(item.outgoing!.clientId)}
                onDiscard={() => thread.discard(item.outgoing!.clientId)}
              />
            )
          }
          const message = item.message!
          switch (message.kind) {
            case 'system':
              return <SystemLine key={item.key} message={message} />
            case 'quote':
              return <QuoteCard key={item.key} message={message} />
            case 'draft':
              return <DraftCard key={item.key} message={message} />
            default:
              return (
                <div key={item.key}>
                  <Bubble
                    message={message}
                    own={item.own}
                    startsGroup={item.startsGroup}
                    endsGroup={item.endsGroup}
                  />
                  {item.own && message.id === lastOwn && seen && thread.outbox.length === 0 && (
                    <p className="text-muted text-caption px-1 text-right">Seen</p>
                  )}
                </div>
              )
          }
        })}
      </div>

      {newBelow > 0 && !atBottom && (
        <button
          type="button"
          onClick={() => {
            toBottom()
            setNewBelow(0)
          }}
          className="text-caption absolute right-4 bottom-24 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-3 font-medium text-white shadow-lg"
        >
          New messages <ArrowDown className="size-3.5" aria-hidden />
        </button>
      )}

      {data.open ? (
        <Composer rules={rules} onSend={(body, files) => thread.send(body, files)} />
      ) : (
        <p className="text-muted border-t border-[var(--border)] px-4 py-3 text-center text-sm">
          This case is complete, so the chat is read-only.
        </p>
      )}
    </section>
  )
}
