import { AnimatePresence, motion } from 'framer-motion'
import { Briefcase, LogOut, Plus, User as UserIcon } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { PERMISSIONS } from '@/auth/permissions'
import { usePermissions } from '@/auth/use-permissions'
import { NotificationBell } from '@/components/layout/notification-bell'
import { Button } from '@/components/ui/button'
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

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <Briefcase className="size-[18px]" strokeWidth={1.75} />
              Advocate Filing
            </NavLink>
            <nav className="hidden items-center gap-6 text-sm sm:flex">
              <NavItem to="/">Cases</NavItem>
              {can(PERMISSIONS.USER_MANAGE) && (
                <NavItem to="/admin/pending-users">Pending lawyers</NavItem>
              )}
              {can(PERMISSIONS.PAYMENT_VIEW_ALL) && (
                <NavItem to="/admin/payments">Payments</NavItem>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {can(PERMISSIONS.CASE_SUBMIT) && (
              <Button size="sm" onClick={() => navigate('/cases/new')}>
                <Plus className="size-4" />
                New case
              </Button>
            )}
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
      <main className="mx-auto max-w-5xl px-6 py-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
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
