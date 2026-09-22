import { Hourglass } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { PageSpinner } from '@/components/ui/page-spinner'
import { StatusPage } from '@/components/ui/status-page'

const POLL_MS = 5_000

// Where a lawyer lands once their email is verified but an admin hasn't
// approved the account yet. It holds the same limited session the pending
// approval gate allows (GET /users/me only) and polls that endpoint, moving
// on to Cases the moment an admin approves — no re-login needed.
export function PendingApprovalPage() {
  const { user, status, refreshUser, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (status !== 'pending') return
    const interval = setInterval(() => {
      refreshUser().catch(() => {
        // A transient network hiccup shouldn't stop the page from trying
        // again next tick; a real session loss will show up as 'unauthenticated'.
      })
    }, POLL_MS)
    return () => clearInterval(interval)
  }, [status, refreshUser])

  if (status === 'loading') return <PageSpinner />
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  if (status === 'authenticated') return <Navigate to="/" replace />

  return (
    <StatusPage
      icon={Hourglass}
      title="Waiting for admin approval"
      description={`${
        user?.email ? `${user.email} is verified. ` : 'Your email is verified. '
      }An admin needs to approve your account before you can use it — this page will move on by itself as soon as that happens.`}
      actions={
        <Button
          variant="secondary"
          onClick={() => {
            void logout()
            navigate('/login')
          }}
        >
          Sign out
        </Button>
      }
    />
  )
}
