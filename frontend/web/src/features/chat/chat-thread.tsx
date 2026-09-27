import { useQuery } from '@tanstack/react-query'
import { ArrowDown } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

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
import { useVisualViewportHeight } from '@/hooks/use-visual-viewport-height'
import { getUploadRules } from '@/lib/api/config'
import { getErrorMessage } from '@/lib/errors'
import type { UploadRules } from '@/types/api'

const NEAR_BOTTOM_PX = 80

const subscribeVisibility = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify)
  return () => document.removeEventListener('visibilitychange', notify)
}
const isTabVisible = () => document.visibilityState === 'visible'


// `card`: a fixed-height card inside a page (the case screen). `fill`: fills its
// container edge to edge (the Messages screen). `header` replaces the default
// "Chat" bar; pass null for none.
export interface ChatThreadProps {
  caseId: string
  ownId: string
  variant?: 'card' | 'fill'
  header?: ReactNode
}

export function ChatThread({ caseId, ownId, variant = 'card', header }: ChatThreadProps) {
  const rules = useQuery({
    queryKey: ['upload-rules'],
    queryFn: getUploadRules,
    staleTime: Infinity,
  })
  if (rules.isError) {
    return (
      <Padded fill={variant === 'fill'}>
        <ErrorState
          error={rules.error}
          title="Couldn't load the chat"
          onRetry={() => void rules.refetch()}
        />
      </Padded>
    )
  }
  if (!rules.data) {
    return (
      <Padded fill={variant === 'fill'}>
        <ChatSkeleton />
      </Padded>
    )
  }
  return (
    <ChatBody caseId={caseId} ownId={ownId} rules={rules.data} variant={variant} header={header} />
  )
}

function Padded({ fill, children }: { fill: boolean; children: ReactNode }) {
  return fill ? <div className="p-4">{children}</div> : <>{children}</>
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

function ChatBody({
  caseId,
  ownId,
  rules,
  variant,
  header,
}: Required<Pick<ChatThreadProps, 'caseId' | 'ownId' | 'variant'>> &
  Pick<ChatThreadProps, 'header'> & { rules: UploadRules }) {
  const fill = variant === 'fill'
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
      <Padded fill={fill}>
        <ErrorState
          error={thread.error}
          title="Couldn't load the chat"
          onRetry={() => void thread.refetch()}
        />
      </Padded>
    )
  }
  if (!data) {
    return (
      <Padded fill={fill}>
        <ChatSkeleton />
      </Padded>
    )
  }

  const lastOwn = lastOwnMessageId(data.messages, ownId)
  const seen = lastOwn !== null && data.otherLastReadId >= lastOwn
  const empty = data.messages.length === 0 && thread.outbox.length === 0

  return (
    <section
      aria-label="Case chat"
      className={
        fill
          ? 'relative flex h-full min-h-0 flex-col overflow-hidden'
          : 'surface shadow-card relative flex min-h-[420px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]'
      }
      style={
        fill
          ? undefined
          : {
              height: viewportHeight
                ? `min(70dvh, ${Math.max(360, viewportHeight - 24)}px)`
                : '70dvh',
            }
      }
    >
      {header === undefined ? (
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-base font-semibold">Chat</h2>
        </div>
      ) : (
        header
      )}

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
                    <p className="text-muted text-label px-1 text-right">Seen</p>
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
          className="text-label absolute right-4 bottom-24 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-4 font-medium text-white shadow-lg"
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
