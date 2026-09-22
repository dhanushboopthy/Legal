import { MailCheck } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { resendOtp } from '@/lib/api/auth'
import { getErrorMessage } from '@/lib/errors'
import { useOtpCooldown } from '@/lib/use-otp-cooldown'
import type { UserOut } from '@/types/api'

const RESEND_COOLDOWN_SECONDS = 60

export function OtpStep({
  email,
  onVerified,
  sendOnMount = false,
}: {
  email: string
  onVerified: (user: UserOut) => void
  sendOnMount?: boolean
}) {
  const { verifyEmail } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const { cooldown, start, clear } = useOtpCooldown('otp', email)

  // Sign-in bounced an unverified account here, so any earlier code may be
  // stale — issue a fresh one. The ref stops StrictMode's double effect run
  // from sending two.
  const sentOnMount = useRef(false)
  useEffect(() => {
    if (!sendOnMount || sentOnMount.current) return
    sentOnMount.current = true
    resendOtp(email)
      .then(() => start(RESEND_COOLDOWN_SECONDS))
      .catch(() => setError('Could not send a new code. Try "Resend code" below.'))
  }, [sendOnMount, email, start])

  const submit = async (candidate: string) => {
    setError(null)
    setVerifying(true)
    try {
      const user = await verifyEmail(email, candidate)
      clear()
      onVerified(user)
    } catch (err) {
      setError(getErrorMessage(err, 'Invalid code. Please try again.'))
    } finally {
      setVerifying(false)
    }
  }

  // Auto-submits at 6 digits so the person never has to also tap Verify —
  // the button stays for anyone whose input method doesn't trigger this
  // (paste without a trailing change event, screen readers, etc).
  const onCodeChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 6)
    setCode(cleaned)
    if (cleaned.length === 6 && !verifying) void submit(cleaned)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (code.length === 6) void submit(code)
  }

  const onResend = async () => {
    setError(null)
    setResending(true)
    try {
      await resendOtp(email)
      start(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not resend the code.'))
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-white">
            <MailCheck className="size-6" strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-muted text-center text-sm">
            We sent a 6-digit code to <span className="font-medium text-[var(--fg)]">{email}</span>
          </p>
        </div>

        <Card>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="otp">Verification code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="text-center text-lg tracking-[0.5em]"
                value={code}
                disabled={verifying}
                onChange={(e) => onCodeChange(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-label text-danger-ink">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              loading={verifying}
              disabled={code.length !== 6}
            >
              Verify
            </Button>
          </form>
        </Card>

        <p className="text-muted mt-6 text-center text-sm">
          Didn't get it?{' '}
          <button
            type="button"
            onClick={onResend}
            disabled={resending || cooldown > 0}
            className="text-accent-ink font-medium disabled:opacity-50"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </button>
        </p>
      </div>
    </div>
  )
}
