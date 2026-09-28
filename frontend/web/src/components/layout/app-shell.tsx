import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ChevronsUpDown,
  Folder,
  LifeBuoy,
  LogOut,
  MessageCircle,
  Receipt,
  Scale,
  Type,
  User as UserIcon,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { PERMISSIONS } from '@/auth/permissions'
import { usePermissions } from '@/auth/use-permissions'
import { NotificationBell } from '@/components/layout/notification-bell'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { listCases } from '@/lib/api/cases'
import { UserAvatar } from '@/components/ui/user-avatar'
import { cn } from '@/lib/utils'

interface Destination {
  to: string
  label: string
  icon: LucideIcon
  badge?: number
}

/**
 * Desktop (lg+): a quiet left sidebar, like Mail or Settings on a Mac.
 * Smaller screens: a slim top bar, plus a bottom tab bar only when there is
 * more than one place to go (a lawyer has just Cases, so gets none).
 * Sign out lives in one place: the account menu.
 */
export function AppShell() {
  const location = useLocation()
  const { can } = usePermissions()
  const reduceMotion = useReducedMotion()

  const { user } = useAuth()
  const hasMessages = can(PERMISSIONS.CASE_SUBMIT) || can(PERMISSIONS.CASE_MESSAGE)
  // Same query (and poll) as the Cases and Messages screens: one cache.
  const cases = useQuery({
    queryKey: ['cases'],
    queryFn: listCases,
    refetchInterval: 30_000,
    enabled: hasMessages,
  })
  const unread = (cases.data ?? []).reduce(
    (sum, c) =>
      sum + (c.junior_lawyer_id === user?.id || can(PERMISSIONS.CASE_MESSAGE) ? c.unread_count : 0),
    0,
  )

  const destinations: Destination[] = [
    { to: '/', label: 'Cases', icon: Folder },
    ...(hasMessages
      ? [{ to: '/messages', label: 'Messages', icon: MessageCircle, badge: unread }]
      : []),
    ...(can(PERMISSIONS.USER_MANAGE)
      ? [{ to: '/admin/people', label: 'People', icon: Users }]
      : []),
    ...(can(PERMISSIONS.PAYMENT_VIEW_ALL)
      ? [{ to: '/admin/payments', label: 'Payments', icon: Receipt }]
      : []),
  ]
  const showTabBar = destinations.length > 1
  // Messages fills the screen like a messaging app. On a phone an open
  // conversation takes all of it, with its own Back button instead of the bars.
  const immersive = /^\/messages(\/|$)/.test(location.pathname)
  const conversationOpen = /^\/messages\/[^/]+/.test(location.pathname)

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="skip-link surface shadow-overlay rounded-[var(--radius-control)] px-4 py-3 text-sm font-medium"
      >
        Skip to main content
      </a>

      <Sidebar destinations={destinations} />
      <TopBar hidden={conversationOpen} />

      <div className="lg:pl-[16.25rem]">
        {immersive ? (
          // No page transition: switching conversations shouldn't animate the list.
          <main
            id="main"
            tabIndex={-1}
            className={cn(
              'outline-none sm:h-[calc(100dvh-4rem)] lg:h-dvh',
              conversationOpen ? 'h-dvh' : 'h-[calc(100dvh-4rem)]',
              showTabBar && 'sm:pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0',
              showTabBar && !conversationOpen && 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]',
            )}
          >
            <Outlet />
          </main>
        ) : (
          <main
            id="main"
            tabIndex={-1}
            className={cn(
              'mx-auto max-w-[55rem] px-4 pt-6 outline-none sm:px-8 lg:pt-12',
              showTabBar ? 'pb-28 lg:pb-16' : 'pb-16',
            )}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15, ease: [0, 0, 0.2, 1] }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        )}
      </div>

      {showTabBar && <BottomTabBar destinations={destinations} hidden={conversationOpen} />}
    </div>
  )
}

function Brand() {
  return (
    <NavLink
      to="/"
      className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] text-base font-semibold tracking-tight"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[0.5rem] bg-navy text-gold">
        <Scale className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="truncate">Advocate Filing</span>
    </NavLink>
  )
}

function Sidebar({ destinations }: { destinations: Destination[] }) {
  return (
    <aside className="sidebar-surface fixed inset-y-0 left-0 z-30 hidden w-[16.25rem] flex-col border-r border-[var(--border)] px-4 py-6 lg:flex">
      <div className="px-2">
        <Brand />
      </div>
      <nav aria-label="Main" className="mt-8 flex flex-col gap-1">
        {destinations.map((d) => (
          <SidebarItem key={d.to} {...d} />
        ))}
      </nav>
      <div className="mt-2">
        <NotificationBell variant="row" />
      </div>
      <div className="mt-auto flex flex-col gap-1 border-t border-[var(--border)] pt-4">
        <SidebarItem to="/help" label="Help" icon={LifeBuoy} />
        <AccountMenu variant="row" />
      </div>
    </aside>
  )
}

function SidebarItem({ to, label, icon: Icon, badge }: Destination) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      // NavLink sets aria-current="page"; the tinted row shows it visually.
      className={({ isActive }) =>
        cn(
          'flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors',
          isActive
            ? 'text-accent-ink bg-white shadow-[0_1px_2px_rgba(15,39,71,0.08)]'
            : 'text-[var(--fg)] hover:bg-ink/[0.05]',
        )
      }
    >
      <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      <span className="flex-1">{label}</span>
      {!!badge && <Badge count={badge} />}
    </NavLink>
  )
}

function Badge({ count }: { count: number }) {
  return (
    <span className="text-caption inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 font-semibold text-white">
      {count > 99 ? '99+' : count}
      <span className="sr-only"> unread</span>
    </span>
  )
}

function TopBar({ hidden }: { hidden: boolean }) {
  return (
    <header
      className={cn(
        'bar-translucent sticky top-0 z-30 border-b border-[var(--border)] lg:hidden',
        hidden && 'max-sm:hidden',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[55rem] items-center justify-between gap-2 px-4 sm:px-8">
        <Brand />
        <div className="flex items-center gap-1">
          <NotificationBell />
          <AccountMenu variant="icon" />
        </div>
      </div>
    </header>
  )
}

function AccountMenu({ variant }: { variant: 'icon' | 'row' }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function signOut() {
    void logout()
    navigate('/login')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'row' ? (
          <button
            aria-label={`Account: ${user?.full_name ?? ''}`}
            className="flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] px-2 text-left transition-colors hover:bg-ink/[0.05]"
          >
            <UserAvatar name={user?.full_name ?? ''} src={user?.avatar_url} className="size-9" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user?.full_name}</span>
              <span className="text-muted text-caption block truncate">{user?.email}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-[var(--fg-muted)]" aria-hidden />
          </button>
        ) : (
          <button
            aria-label={`Account: ${user?.full_name ?? ''}`}
            className="flex size-11 items-center justify-center rounded-full transition-colors hover:bg-ink/[0.06]"
          >
            <UserAvatar name={user?.full_name ?? ''} src={user?.avatar_url} className="size-9" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-64">
        <div className="px-3 py-2">
          <p className="text-sm font-medium">{user?.full_name}</p>
          <p className="text-muted text-label break-all">{user?.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/profile')}>
          <UserIcon className="size-5" aria-hidden /> Your profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/profile#text-size')}>
          <Type className="size-5" aria-hidden /> Text size
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/help')} className="lg:hidden">
          <LifeBuoy className="size-5" aria-hidden /> Help
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="size-5" aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BottomTabBar({ destinations, hidden }: { destinations: Destination[]; hidden: boolean }) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'bar-translucent fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--border)] lg:hidden',
        hidden && 'max-sm:hidden',
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {destinations.map(({ to, label, icon: Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5',
              isActive ? 'text-accent-ink' : 'text-[var(--fg-muted)]',
            )
          }
        >
          <span className="relative">
            <Icon className="size-6" strokeWidth={1.75} aria-hidden />
            {!!badge && (
              <span className="absolute -top-1.5 left-4">
                <Badge count={badge} />
              </span>
            )}
          </span>
          <span className="text-caption font-medium">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
