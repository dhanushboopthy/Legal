import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Briefcase,
  ChevronDown,
  Folder,
  LifeBuoy,
  LogOut,
  MessageCircle,
  Receipt,
  Type,
  User as UserIcon,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
import { cn } from '@/lib/utils'

export function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { can } = usePermissions()
  const showPeople = can(PERMISSIONS.USER_MANAGE)
  const showPayments = can(PERMISSIONS.PAYMENT_VIEW_ALL)
  // Case owners and whoever holds case:message are in chats; a clerk isn't.
  const showMessages = can(PERMISSIONS.CASE_MESSAGE) || can(PERMISSIONS.CASE_VIEW_OWN)
  const reduceMotion = useReducedMotion()
  // Messages fills the screen like a messaging app; on a phone an open
  // conversation takes it all, with its own back button instead of the bars.
  const immersive = /^\/messages(\/|$)/.test(location.pathname)
  const conversationOpen = /^\/messages\/[^/]+/.test(location.pathname)
  const firstName = user?.full_name.split(' ')[0] ?? ''

  function signOut() {
    void logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="skip-link surface shadow-card rounded-[var(--radius-control)] px-4 py-3 text-sm font-semibold"
      >
        Skip to main content
      </a>
      <header
        className={cn(
          'sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-xl',
          conversationOpen && 'hidden sm:block',
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
          <div className="flex items-center gap-4 lg:gap-8">
            <NavLink
              to="/"
              className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] text-lg font-bold tracking-tight"
            >
              <Briefcase className="size-6" strokeWidth={1.75} aria-hidden />
              <span className="sm:max-lg:sr-only">Advocate Filing</span>
            </NavLink>
            <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
              <NavItem to="/">Cases</NavItem>
              {showMessages && <NavItem to="/messages">Messages</NavItem>}
              {showPeople && <NavItem to="/admin/people">People</NavItem>}
              {showPayments && <NavItem to="/admin/payments">Payments</NavItem>}
              <NavItem to="/help">Help</NavItem>
            </nav>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Account: ${user?.full_name ?? ''}`}
                  className="flex min-h-11 items-center gap-2 rounded-full px-2 text-sm font-semibold transition-colors hover:bg-black/[0.06] lg:px-3"
                >
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-[var(--fg)] text-white"
                  >
                    {user?.full_name.charAt(0).toUpperCase()}
                  </span>
                  <span className="hidden max-w-32 truncate lg:inline">{firstName}</span>
                  <ChevronDown className="size-4" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-64">
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold">{user?.full_name}</p>
                  <p className="text-muted text-label break-all">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/profile')}>
                  <UserIcon className="size-5" aria-hidden /> Your profile
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/profile#text-size')}>
                  <Type className="size-5" aria-hidden /> Text size
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/help')}>
                  <LifeBuoy className="size-5" aria-hidden /> Help
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={signOut}>
                  <LogOut className="size-5" aria-hidden /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={signOut}
              className="hidden min-h-11 items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 text-sm font-semibold transition-colors hover:bg-black/[0.05] lg:inline-flex"
            >
              <LogOut className="size-5" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      </header>
      {immersive ? (
        // No page transition here: switching conversations shouldn't animate the inbox.
        <main
          id="main"
          tabIndex={-1}
          className={cn(
            'mx-auto max-w-6xl outline-none sm:h-[calc(100dvh-4rem)] sm:px-6 sm:py-6',
            conversationOpen ? 'h-dvh' : 'h-[calc(100dvh-4rem)]',
          )}
        >
          <Outlet />
        </main>
      ) : (
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto max-w-5xl px-4 py-8 pb-28 outline-none sm:px-6 sm:py-10 sm:pb-12"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      )}
      {!conversationOpen && (
        <BottomTabBar
          showMessages={showMessages}
          showPeople={showPeople}
          showPayments={showPayments}
        />
      )}
    </div>
  )
}

function NavItem({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      // NavLink sets aria-current="page" on the active item; the bar under it
      // shows the same thing to sighted users without relying on colour.
      className={({ isActive }) =>
        cn(
          'inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold text-[var(--fg)] transition-colors hover:bg-black/[0.05]',
          isActive && 'bg-black/[0.06] shadow-[inset_0_-3px_0_var(--color-accent)]',
        )
      }
    >
      {children}
    </NavLink>
  )
}

function BottomTabBar({
  showMessages,
  showPeople,
  showPayments,
}: {
  showMessages: boolean
  showPeople: boolean
  showPayments: boolean
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur-xl sm:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <TabItem to="/" icon={Folder} label="Cases" />
      {showMessages && <TabItem to="/messages" icon={MessageCircle} label="Messages" />}
      {showPeople && <TabItem to="/admin/people" icon={Users} label="People" />}
      {showPayments && <TabItem to="/admin/payments" icon={Receipt} label="Payments" />}
      <TabItem to="/help" icon={LifeBuoy} label="Help" />
    </nav>
  )
}

function TabItem({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[var(--fg-muted)]',
          isActive && 'text-accent-ink shadow-[inset_0_3px_0_var(--color-accent)]',
        )
      }
    >
      <Icon className="size-6" strokeWidth={1.75} aria-hidden />
      <span className="text-caption font-semibold">{label}</span>
    </NavLink>
  )
}
