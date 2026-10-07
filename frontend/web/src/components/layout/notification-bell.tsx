import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast-context'
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notifications'
import { getErrorMessage } from '@/lib/errors'
import { notificationMeta, TONE_CLASSES } from '@/lib/notification-meta'
import { cn, dayGroup, formatRelativeTime, type DayGroup } from '@/lib/utils'
import type { NotificationOut } from '@/types/api'

const QUERY_KEY = ['notifications']
const GROUPS: DayGroup[] = ['Today', 'Yesterday', 'Earlier']

type Filter = 'all' | 'unread'

export function NotificationBell({ variant = 'icon' }: { variant?: 'icon' | 'row' }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  const {
    data: notifications,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: listMyNotifications,
    refetchInterval: 30_000,
  })

  const list = notifications ?? []
  const unreadCount = list.filter((n) => !n.is_read).length

  // Marking read is instant on screen; a failure puts the server's answer back.
  const patch = (fn: (n: NotificationOut) => NotificationOut) =>
    queryClient.setQueryData<NotificationOut[]>(QUERY_KEY, (old) => old?.map(fn))

  const markOne = useMutation({
    mutationFn: markNotificationRead,
    onMutate: (id: string) => patch((n) => (n.id === id ? { ...n, is_read: true } : n)),
    onError: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: () => patch((n) => ({ ...n, is_read: true })),
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast({
        variant: 'error',
        title: "Couldn't mark notifications as read",
        description: getErrorMessage(err),
      })
    },
  })

  const openNotification = (n: NotificationOut) => {
    if (!n.is_read) markOne.mutate(n.id)
    setOpen(false)
    // A notification takes you to what it is about (F-16).
    if (n.case_id) navigate(`/cases/${n.case_id}`)
  }

  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
  const count = unreadCount > 0 && (
    <span
      aria-hidden
      className="flex min-w-6 items-center justify-center rounded-full bg-[var(--color-danger)] px-1.5 text-caption font-semibold text-white"
    >
      {unreadCount > 9 ? '9+' : unreadCount}
    </span>
  )

  const shown = filter === 'unread' ? list.filter((n) => !n.is_read) : list

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === 'row' ? (
          // A sidebar row, styled like the navigation items around it.
          <button
            aria-label={label}
            className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors hover:bg-ink/[0.05]"
          >
            <Bell className="size-5" strokeWidth={1.75} aria-hidden />
            <span aria-hidden className="flex-1 text-left">
              Notifications
            </span>
            {count}
          </button>
        ) : (
          <button
            aria-label={label}
            className="relative flex size-11 items-center justify-center rounded-full transition-colors hover:bg-ink/[0.06]"
          >
            <Bell className="size-6" strokeWidth={1.75} aria-hidden />
            {count && <span className="absolute -top-0.5 left-6">{count}</span>}
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent
        label="Notifications"
        align={variant === 'row' ? 'start' : 'end'}
        className="w-[26rem] max-w-[calc(100vw-1.5rem)] overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <button
            type="button"
            disabled={unreadCount === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
            className="text-accent-ink min-h-11 rounded-full px-3 text-sm font-medium transition-colors hover:bg-[var(--color-accent)]/10 disabled:text-[var(--fg-muted)] disabled:opacity-60 disabled:hover:bg-transparent"
          >
            Mark all as read
          </button>
        </div>

        <div className="px-4 pb-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="flex w-full flex-nowrap" aria-label="Show">
              <TabsTrigger value="all" className="flex-1 px-3">
                All
              </TabsTrigger>
              <TabsTrigger value="unread" className="flex-1 px-3">
                Unread{unreadCount > 0 && ` (${unreadCount})`}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="max-h-[min(28rem,60dvh)] overflow-y-auto border-t border-[var(--border)]">
          {isLoading ? (
            <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading notifications">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-10 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : error && !notifications ? (
            <div role="alert" className="px-5 py-10 text-center text-sm">
              <p className="font-medium">Couldn't load notifications</p>
              <p className="text-muted mt-1">Check your connection and try again.</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="text-accent-ink mt-3 min-h-11 rounded-full px-4 font-medium hover:bg-[var(--color-accent)]/10"
              >
                Try again
              </button>
            </div>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-ink/[0.05]">
                <BellOff className="size-6 text-[var(--fg-muted)]" strokeWidth={1.5} aria-hidden />
              </div>
              <p className="mt-3 font-semibold">
                {filter === 'unread' ? 'No unread notifications' : "You're all caught up"}
              </p>
              <p className="text-muted mt-1 max-w-64 text-sm">
                {filter === 'unread'
                  ? 'Everything has been read.'
                  : 'Updates about your cases will appear here.'}
              </p>
            </div>
          ) : (
            GROUPS.map((group) => {
              const rows = shown.filter((n) => dayGroup(n.created_at) === group)
              if (rows.length === 0) return null
              return (
                <section key={group} aria-label={group}>
                  <h3 className="text-label bg-ink/[0.03] px-5 py-2 font-semibold">{group}</h3>
                  <ul>
                    {rows.map((n) => (
                      <li key={n.id} className="border-b border-[var(--border)] last:border-b-0">
                        <NotificationRow n={n} onOpen={() => openNotification(n)} />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NotificationRow({ n, onOpen }: { n: NotificationOut; onOpen: () => void }) {
  const { icon: Icon, tone } = notificationMeta(n.kind)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-ink/[0.05]',
        !n.is_read && 'bg-[var(--color-accent)]/[0.04]',
      )}
    >
      {/* The unread dot sits in its own column so read and unread rows line up. */}
      <span aria-hidden className="mt-4 flex w-2.5 shrink-0 justify-center">
        {!n.is_read && <span className="size-2.5 rounded-full bg-[var(--color-accent)]" />}
      </span>
      <span
        aria-hidden
        className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', TONE_CLASSES[tone])}
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        {!n.is_read && <span className="sr-only">Unread. </span>}
        <span className={cn('block text-sm leading-snug break-words', !n.is_read && 'font-medium')}>
          {n.message}
        </span>
        <span className="text-muted text-label mt-1 block">{formatRelativeTime(n.created_at)}</span>
      </span>
    </button>
  )
}
