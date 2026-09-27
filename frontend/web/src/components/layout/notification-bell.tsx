import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { listMyNotifications, markNotificationRead } from '@/lib/api/notifications'
import { cn, formatDate } from '@/lib/utils'

export function NotificationBell() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const {
    data: notifications,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['notifications'],
    queryFn: listMyNotifications,
    refetchInterval: 30_000,
  })

  const list = notifications ?? []
  const unreadCount = list.filter((n) => !n.is_read).length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-2 text-sm font-semibold transition-colors hover:bg-black/[0.06] lg:px-3"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Bell className="size-6" strokeWidth={1.75} aria-hidden />
          <span aria-hidden className="hidden lg:inline">
            Alerts
          </span>
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute -top-0.5 left-6 flex min-w-6 items-center justify-center rounded-full bg-[var(--color-danger)] px-1.5 text-caption font-bold text-white"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[26rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="text-base font-semibold">Notifications</p>
        </div>
        <div className="max-h-[28rem] overflow-y-auto p-1.5">
          {isLoading ? (
            <p className="text-muted px-3 py-6 text-center text-sm">Loading…</p>
          ) : error && !notifications ? (
            <div role="alert" className="px-3 py-6 text-center text-sm">
              <p className="text-muted">Couldn't load notifications.</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="text-accent-ink mt-2 font-medium"
              >
                Try again
              </button>
            </div>
          ) : list.length === 0 ? (
            <p className="text-muted px-3 py-6 text-center text-sm">You're all caught up.</p>
          ) : (
            list.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className={cn(
                  'flex-col items-start gap-0.5',
                  !n.is_read && 'bg-[var(--color-accent)]/5',
                )}
                onSelect={() => {
                  if (!n.is_read) {
                    void markNotificationRead(n.id).then(() =>
                      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
                    )
                  }
                  // A notification takes you to what it is about (F-16).
                  if (n.case_id) navigate(`/cases/${n.case_id}`)
                }}
              >
                <p className="text-sm leading-snug">{n.message}</p>
                <p className="text-muted text-label">{formatDate(n.created_at)}</p>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
