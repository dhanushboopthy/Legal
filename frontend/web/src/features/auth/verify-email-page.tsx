import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { OtpStep } from '@/features/auth/otp-step'

interface VerifyState {
  email?: string
  // Set when the user arrived from a sign-in attempt rather than straight
  // after registering, so their old code may have expired.
  resend?: boolean
}

export function VerifyEmailPage() {
  const navigate = useNavigate()
  const state = useLocation().state as VerifyState | null

  // The email only lives in router state; a hard refresh loses it.
  if (!state?.email) return <Navigate to="/login" replace />

  return (
    <OtpStep
      email={state.email}
      sendOnMount={state.resend}
      onVerified={() =>
        navigate('/pending-approval', { state: { email: state.email }, replace: true })
      }
    />
  )
}
