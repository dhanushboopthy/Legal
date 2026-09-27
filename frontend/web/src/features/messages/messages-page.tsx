import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Info, MessageCircle, Search } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { usePermissions } from '@/auth/use-permissions'
import { buttonVariants } from '@/components/ui/button-variants'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { hasChat } from '@/features/chat/chat-access'
import { ChatThread } from '@/features/chat/chat-thread'
import { Avatar } from '@/features/messages/avatar'
import { shortTime } from '@/features/messages/short-time'
import { useVisualViewportHeight } from '@/hooks/use-visual-viewport-height'
import { listCases } from '@/lib/api/cases'
import { getStatusMeta, perspectiveFor, type Perspective } from '@/lib/status-meta'
import { cn, formatDate } from '@/lib/utils'
import type { CaseListItem } from '@/types/api'

const WIDE = '(min-width: 640px)'

function useIsWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(WIDE)
      query?.addEventListener('change', notify)
      return () => query?.removeEventListener('change', notify)
    },
    () => window.matchMedia?.(WIDE).matches ?? true,
    () => true,
  )
}

const latestAt = (c: CaseListItem) => Date.parse(c.last_message?.at ?? c.updated_at)

// Every case chat the viewer is in, as an inbox: the list on the left and the
// open conversation on the right, or one at a time on a phone, where an open
// conversation takes the whole screen (see AppShell's immersive layout).
export function MessagesPage() {
  const { caseId } = useParams<{ caseId?: string }>()
  const { user } = useAuth()
  const { can } = usePermissions()
  const perspective = perspectiveFor(can)
  const [query, setQuery] = useState('')
  const isWide = useIsWide()
  const viewportHeight = useVisualViewportHeight()

  // Same query as the Cases screen, so the two share one cache and one poll.
  const cases = useQuery({ queryKey: ['cases'], queryFn: listCases, refetchInterval: 30_000 })

  const conversations = useMemo(
    () =>
      (cases.data ?? [])
        .filter((c) => hasChat(c, user?.id, can))
        .sort((a, b) => latestAt(b) - latestAt(a)),
    [cases.data, user?.id, can],
  )
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.junior_lawyer_name.toLowerCase().includes(q) ||
        c.case_number?.toLowerCase().includes(q),
    )
  }, [conversations, query])

  const open = caseId ? conversations.find((c) => c.id === caseId) : undefined

  return (
    <div
      className="surface flex h-full overflow-hidden sm:rounded-[var(--radius-card)] sm:border sm:border-[var(--border)] sm:shadow-card"
      // A phone's keyboard shrinks the visual viewport only: follow it so the
      // composer of a full-screen conversation stays above the keyboard.
      style={caseId && !isWide && viewportHeight ? { height: viewportHeight } : undefined}
    >
      <aside
        aria-label="Conversations"
        className={cn(
          'min-w-0 flex-col sm:flex sm:w-80 sm:shrink-0 sm:border-r sm:border-[var(--border)]',
          caseId ? 'hidden' : 'flex w-full',
        )}
      >
        <div className="px-4 pt-5 pb-3">
          <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
          <div className="relative mt-3">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--fg-muted)]"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search conversations"
              className="min-h-11 w-full rounded-full bg-black/[0.05] py-2 pr-3 pl-9 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 sm:min-h-9"
            />
          </div>
        </div>
        {/* Room at the bottom for the phone's tab bar. */}
        <div className="flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-2">
          {cases.isLoading ? (
            <ListSkeleton />
          ) : cases.error && !cases.data ? (
            <div className="px-4">
              <ErrorState
                error={cases.error}
                title="Couldn't load your messages"
                onRetry={() => void cases.refetch()}
              />
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-4">
              <EmptyState
              icon={MessageCircle}
              title="No conversations yet"
              description={
                perspective === 'submitter'
                  ? 'A chat with the advocate opens once they accept one of your cases.'
                  : 'A chat with the lawyer opens when you accept their case.'
                }
              />
            </div>
          ) : shown.length === 0 ? (
            <p className="text-muted px-4 py-8 text-center text-sm">No conversations match.</p>
          ) : (
            <ul>
              {shown.map((c) => (
                <li key={c.id}>
                  <ConversationRow conversation={c} ownId={user?.id} perspective={perspective} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className={cn('min-w-0 flex-1 flex-col', caseId ? 'flex' : 'hidden sm:flex')}>
        {!caseId ? (
          <NoneOpen />
        ) : cases.isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : open && user ? (
          <Conversation conversation={open} ownId={user.id} perspective={perspective} />
        ) : cases.error && !cases.data ? (
          <div className="p-4">
            <ErrorState
              error={cases.error}
              title="Couldn't load this conversation"
              onRetry={() => void cases.refetch()}
            />
          </div>
        ) : (
          <Unavailable />
        )}
      </div>
    </div>
  )
}

// Who the conversation is with, as the viewer sees it: the advocate talks to a
// named lawyer; the lawyer's chats are all with the advocate, so the case names it.
function nameFor(c: CaseListItem, perspective: Perspective): string {
  return perspective === 'reviewer' ? c.junior_lawyer_name : c.title
}

function ConversationRow({
  conversation: c,
  ownId,
  perspective,
}: {
  conversation: CaseListItem
  ownId: string | undefined
  perspective: Perspective
}) {
  const unread = c.unread_count > 0
  const last = c.last_message
  const preview = last
    ? `${last.sender_id && last.sender_id === ownId ? 'You: ' : ''}${last.preview}`
    : 'No messages yet'

  return (
    <NavLink
      to={`/messages/${c.id}`}
      className={({ isActive }) =>
        cn(
          'flex min-h-[4.5rem] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-black/[0.03]',
          isActive && 'bg-black/[0.05] hover:bg-black/[0.05]',
        )
      }
    >
      <Avatar name={nameFor(c, perspective)} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>
          {c.title}
          {perspective === 'reviewer' && (
            <span className="text-muted font-normal"> · {c.junior_lawyer_name}</span>
          )}
        </p>
        <p
          className={cn(
            'text-label flex min-w-0 gap-1',
            unread ? 'font-semibold text-[var(--fg)]' : 'text-muted',
          )}
        >
          <span className="truncate">{preview}</span>
          {last && (
            <>
              <span aria-hidden>·</span>
              <time dateTime={last.at} title={formatDate(last.at)} className="shrink-0">
                {shortTime(last.at)}
              </time>
            </>
          )}
        </p>
      </div>
      {unread && (
        <span
          role="img"
          aria-label={`${c.unread_count} unread ${c.unread_count === 1 ? 'message' : 'messages'}`}
          className="size-2.5 shrink-0 rounded-full bg-[var(--color-accent)]"
        />
      )}
    </NavLink>
  )
}

function Conversation({
  conversation: c,
  ownId,
  perspective,
}: {
  conversation: CaseListItem
  ownId: string
  perspective: Perspective
}) {
  const status = getStatusMeta(c.status, perspective).label
  const subtitle =
    perspective === 'reviewer'
      ? `${c.junior_lawyer_name} · ${status}`
      : [c.case_number, status].filter(Boolean).join(' · ')

  return (
    <>
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-2 py-2 sm:px-4">
        <Link
          to="/messages"
          aria-label="Back to conversations"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.05] sm:hidden"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <Avatar name={nameFor(c, perspective)} className="size-10" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{c.title}</h2>
          <p className="text-muted text-caption truncate">{subtitle}</p>
        </div>
        <Link
          to={`/cases/${c.id}`}
          className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'shrink-0' })}
        >
          <Info className="size-4" aria-hidden /> View case
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        {/* Keyed so each conversation starts fresh: its own scroll, divider and outbox. */}
        <ChatThread key={c.id} caseId={c.id} ownId={ownId} variant="fill" header={null} />
      </div>
    </>
  )
}

function NoneOpen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <span className="flex size-20 items-center justify-center rounded-full border-2 border-[var(--fg)]">
        <MessageCircle className="size-9" strokeWidth={1.5} aria-hidden />
      </span>
      <h2 className="mt-4 text-lg font-semibold">Your messages</h2>
      <p className="text-muted mt-1 text-sm">Pick a conversation to read and reply.</p>
    </div>
  )
}

function Unavailable() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={MessageCircle}
        title="This conversation isn't available"
        description="It may not have a chat yet, or you're not part of it."
        action={
          <Link to="/messages" className={buttonVariants({ size: 'sm', className: 'mt-3' })}>
            Back to messages
          </Link>
        }
      />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-1 px-4" aria-busy="true" aria-label="Loading conversations">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          <Skeleton className="size-12 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}
