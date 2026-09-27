import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { destinationFor } from '@/auth/destination'
import { OtpStep } from '@/features/auth/otp-step'
import type { UserOut } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'

const EMAIL_KEY = 'verify-email:address'

interface VerifyState {
  email?: string
  // Set when the user arrived from a sign-in attempt rather than straight
  // after registering, so their old code may have expired.
  resend?: boolean
}

export function VerifyEmailPage() {
  usePageTitle('Verify your email')
  const navigate = useNavigate()
  const state = useLocation().state as VerifyState | null

  // Router state doesn't survive a hard refresh; sessionStorage does. Landing
  // here with state.email (from register or a bounced sign-in) refreshes it.
  const email = state?.email ?? sessionStorage.getItem(EMAIL_KEY)
  if (state?.email) sessionStorage.setItem(EMAIL_KEY, state.email)

  if (!email) return <Navigate to="/login" replace />

  const onVerified = (user: UserOut) => {
    sessionStorage.removeItem(EMAIL_KEY)
    navigate(destinationFor(user), { replace: true })
  }

  return <OtpStep email={email} sendOnMount={state?.resend} onVerified={onVerified} />
}
