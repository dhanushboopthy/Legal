import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, FolderOpen, MessageCircle, Scale, Search } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { usePermissions } from '@/auth/use-permissions'
import { buttonVariants } from '@/components/ui/button-variants'
import { EmptyState } from '@/components/ui/empty-state'
import { UserAvatar } from '@/components/ui/user-avatar'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { hasChat } from '@/features/chat/chat-access'
import { ChatThread } from '@/features/chat/chat-thread'
import { usePageTitle } from '@/hooks/use-page-title'
import { useVisualViewportHeight } from '@/hooks/use-visual-viewport-height'
import { listCases } from '@/lib/api/cases'
import { getStatusMeta, perspectiveFor, type Perspective } from '@/lib/status-meta'
import { shortTime } from '@/lib/time'
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

/** Every case chat the viewer is in, like a messaging app: the list on the
 * left and the open conversation on the right, or one at a time on a phone,
 * where an open conversation takes the whole screen (AppShell hides its bars). */
export function MessagesPage() {
  usePageTitle('Messages')
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
      className="surface flex h-full overflow-hidden"
      // A phone's keyboard shrinks the visual viewport only: follow it so the
      // composer of a full-screen conversation stays above the keyboard.
      style={caseId && !isWide && viewportHeight ? { height: viewportHeight } : undefined}
    >
      <aside
        aria-label="Conversations"
        className={cn(
          'min-w-0 flex-col sm:flex sm:w-[22rem] sm:shrink-0 sm:border-r sm:border-[var(--border)]',
          caseId ? 'hidden' : 'flex w-full',
        )}
      >
        <div className="px-4 pt-5 pb-3 sm:px-5">
          <h1 className="text-2xl font-semibold">Messages</h1>
          {conversations.length > 0 && (
            <div className="relative mt-4">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--fg-muted)]"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search conversations"
                className="min-h-11 w-full rounded-full bg-ink/[0.05] py-2 pr-3 pl-10 text-sm placeholder:text-[var(--fg-muted)]"
              />
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto pb-2">
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

      <div className={cn('min-w-0 flex-1 flex-col bg-[var(--bg)]', caseId ? 'flex' : 'hidden sm:flex')}>
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

// Who the conversation is with: the advocate talks to many named lawyers, so
// each gets their initials; a lawyer's chats are all with the advocate, so
// they share one mark and the case title tells them apart.
function ConversationAvatar({
  conversation: c,
  perspective,
  className,
}: {
  conversation: CaseListItem
  perspective: Perspective
  className?: string
}) {
  if (perspective === 'reviewer')
    return (
      <UserAvatar
        name={c.junior_lawyer_name}
        src={c.junior_lawyer_avatar_url}
        className={className}
      />
    )
  return (
    <span
      aria-hidden
      className={cn(
        'text-accent-ink inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10',
        className,
      )}
    >
      <Scale className="size-5" strokeWidth={1.75} />
    </span>
  )
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
          'flex min-h-[4.5rem] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink/[0.03] sm:px-5',
          isActive && 'bg-ink/[0.05] hover:bg-ink/[0.05]',
        )
      }
    >
      <ConversationAvatar conversation={c} perspective={perspective} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>
          {perspective === 'reviewer' ? c.junior_lawyer_name : c.title}
        </p>
        {perspective === 'reviewer' && <p className="text-muted text-label truncate">{c.title}</p>}
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
  const title = perspective === 'reviewer' ? c.junior_lawyer_name : c.title
  const subtitle =
    perspective === 'reviewer'
      ? `${c.title} · ${status}`
      : [c.case_number, status].filter(Boolean).join(' · ')

  return (
    <>
      <header className="surface flex min-h-16 items-center gap-3 border-b border-[var(--border)] px-2 py-2 sm:px-5">
        <Link
          to="/messages"
          aria-label="Back to conversations"
          className="text-accent-ink inline-flex min-h-11 shrink-0 items-center rounded-full pr-2 text-sm font-medium hover:bg-ink/[0.05] sm:hidden"
        >
          <ChevronLeft className="size-6" aria-hidden />
          <span aria-hidden>Back</span>
        </Link>
        <ConversationAvatar
          conversation={c}
          perspective={perspective}
          className="hidden size-10 sm:inline-flex"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          <p className="text-muted text-label truncate">{subtitle}</p>
        </div>
        <Link
          to={`/cases/${c.id}`}
          aria-label="Open case"
          className={buttonVariants({
            variant: 'secondary',
            size: 'sm',
            className: 'shrink-0 max-sm:px-4',
          })}
        >
          <FolderOpen className="size-4" aria-hidden />
          {/* Short on a phone, so the name above keeps its room. */}
          <span className="sm:hidden">Case</span>
          <span className="hidden sm:inline">Open case</span>
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
      <p className="text-muted mt-1 text-sm">Choose a conversation to read and reply.</p>
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
