import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Briefcase, Folder, LogOut, Receipt, User as UserIcon, Users } from 'lucide-react'
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
  const reduceMotion = useReducedMotion()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <Briefcase className="size-[18px]" strokeWidth={1.75} />
              Advocate Filing
            </NavLink>
            <nav className="hidden items-center gap-6 text-sm sm:flex">
              <NavItem to="/">Cases</NavItem>
              {showPeople && <NavItem to="/admin/people">People</NavItem>}
              {showPayments && <NavItem to="/admin/payments">Payments</NavItem>}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Account menu"
                  className="flex size-9 items-center justify-center rounded-full bg-black/[0.05] text-sm font-medium transition-colors hover:bg-black/[0.08]"
                >
                  {user?.full_name.charAt(0).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <div className="px-2.5 py-1.5">
                  <p className="text-sm font-medium">{user?.full_name}</p>
                  <p className="text-muted text-label">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/profile')}>
                  <UserIcon className="size-4" /> Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    void logout()
                    navigate('/login')
                  }}
                >
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 pb-24 sm:px-6 sm:pb-10">
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
      <BottomTabBar showPeople={showPeople} showPayments={showPayments} />
    </div>
  )
}

function NavItem({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]',
          isActive && 'text-[var(--fg)]',
        )
      }
    >
      {children}
    </NavLink>
  )
}

function BottomTabBar({ showPeople, showPayments }: { showPeople: boolean; showPayments: boolean }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur-xl sm:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <TabItem to="/" icon={Folder} label="Cases" />
      {showPeople && <TabItem to="/admin/people" icon={Users} label="People" />}
      {showPayments && <TabItem to="/admin/payments" icon={Receipt} label="Payments" />}
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
          isActive && 'text-[var(--color-accent)]',
        )
      }
    >
      <Icon className="size-5" strokeWidth={1.75} />
      <span className="text-caption font-medium">{label}</span>
    </NavLink>
  )
}
