import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'

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
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: listMyNotifications,
    refetchInterval: 30_000,
  })

  const unreadCount = notifications.filter((n) => !n.is_read).length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative flex size-9 items-center justify-center rounded-full transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          aria-label="Notifications"
        >
          <Bell className="size-[18px]" strokeWidth={1.75} />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[var(--color-danger)]" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 p-0">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {notifications.length === 0 ? (
            <p className="text-muted px-3 py-6 text-center text-sm">You're all caught up.</p>
          ) : (
            notifications.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className={cn(
                  'flex-col items-start gap-0.5',
                  !n.is_read && 'bg-[var(--color-accent)]/5',
                )}
                onSelect={(e) => {
                  e.preventDefault()
                  if (!n.is_read) {
                    markNotificationRead(n.id).then(() =>
                      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
                    )
                  }
                }}
              >
                <p className="text-[13px] leading-snug">{n.message}</p>
                <p className="text-muted text-[11px]">{formatDate(n.created_at)}</p>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
