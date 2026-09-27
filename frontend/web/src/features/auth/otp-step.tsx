import { MailCheck } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { useAuth } from '@/auth/auth-context'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { resendOtp } from '@/lib/api/auth'
import { getErrorMessage } from '@/lib/errors'
import type { UserOut } from '@/types/api'

const RESEND_COOLDOWN_SECONDS = 60

// A refresh shouldn't reset the visible resend timer to zero — the real OTP
// expiry is server-side either way, this just keeps the UI honest.
function cooldownKey(email: string): string {
  return `otp-resend-until:${email}`
}

function readStoredCooldown(email: string): number {
  const until = Number(sessionStorage.getItem(cooldownKey(email)) ?? 0)
  return Math.max(0, Math.ceil((until - Date.now()) / 1000))
}

function storeCooldown(email: string, seconds: number): void {
  sessionStorage.setItem(cooldownKey(email), String(Date.now() + seconds * 1000))
}

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
  const [cooldown, setCooldown] = useState(() => readStoredCooldown(email))

  // Sign-in bounced an unverified account here, so any earlier code may be
  // stale — issue a fresh one. The ref stops StrictMode's double effect run
  // from sending two.
  const sentOnMount = useRef(false)
  useEffect(() => {
    if (!sendOnMount || sentOnMount.current) return
    sentOnMount.current = true
    resendOtp(email)
      .then(() => {
        storeCooldown(email, RESEND_COOLDOWN_SECONDS)
        setCooldown(RESEND_COOLDOWN_SECONDS)
      })
      .catch(() => setError('Could not send a new code. Try "Resend code" below.'))
  }, [sendOnMount, email])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const submit = async (candidate: string) => {
    setError(null)
    setVerifying(true)
    try {
      const user = await verifyEmail(email, candidate)
      sessionStorage.removeItem(cooldownKey(email))
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
      storeCooldown(email, RESEND_COOLDOWN_SECONDS)
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not resend the code.'))
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthLayout
      icon={MailCheck}
      title="Check your email"
      subtitle={
        <>
          We sent a 6-digit code to <span className="font-medium text-[var(--fg)] break-all">{email}</span>
        </>
      }
      footer={
        <p>
          Didn&rsquo;t get it?{' '}
          <button
            type="button"
            onClick={onResend}
            disabled={resending || cooldown > 0}
            className="text-accent-ink inline-flex min-h-11 items-center font-medium disabled:opacity-60"
          >
            {cooldown > 0 ? `Resend in ${cooldown} seconds` : 'Resend code'}
          </button>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <Label htmlFor="otp">6-digit code</Label>
          <Input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="text-center text-2xl tracking-[0.4em] tabular-nums"
            value={code}
            disabled={verifying}
            onChange={(e) => onCodeChange(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-danger-ink text-sm font-medium">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={verifying} disabled={code.length !== 6}>
          Verify
        </Button>
      </form>
    </AuthLayout>
  )
}
