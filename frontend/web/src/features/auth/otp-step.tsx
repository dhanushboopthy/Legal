import { isAxiosError } from 'axios'
import { MailCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { resendOtp, verifyEmail } from '@/lib/api/auth'

const RESEND_COOLDOWN_SECONDS = 60

export function OtpStep({ email, onVerified }: { email: string; onVerified: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const describeError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err) && typeof err.response?.data?.detail === 'string') {
      return err.response.data.detail
    }
    return fallback
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setVerifying(true)
    try {
      await verifyEmail(email, code)
      onVerified()
    } catch (err) {
      setError(describeError(err, 'Invalid code. Please try again.'))
    } finally {
      setVerifying(false)
    }
  }

  const onResend = async () => {
    setError(null)
    setResending(true)
    try {
      await resendOtp(email)
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setError(describeError(err, 'Could not resend the code.'))
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
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
            {error && <p className="text-[13px] text-[var(--color-danger)]">{error}</p>}
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
            className="font-medium text-[var(--color-accent)] disabled:opacity-50"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </button>
        </p>
      </div>
    </div>
  )
}
