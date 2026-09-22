import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast-context'
import { getErrorMessage } from '@/lib/errors'
import { requestPhoneOtp, verifyPhoneOtp } from '@/lib/api/users'
import { useOtpCooldown } from '@/lib/use-otp-cooldown'

const RESEND_COOLDOWN_SECONDS = 60

type Step = 'view' | 'enter' | 'otp'

// A phone number is never saved directly — see CLAUDE.md. This walks
// enter number -> we text a code -> confirm it, the same shape as the
// email-verification step (src/features/auth/otp-step.tsx) but inline and
// compact, since it's one field on an otherwise ordinary form.
export function PhoneField({ phone }: { phone: string | null }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('view')
  const [candidate, setCandidate] = useState(phone ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { cooldown, start, clear } = useOtpCooldown('profile-phone', candidate)

  const reset = () => {
    setStep('view')
    setCandidate(phone ?? '')
    setCode('')
    setError(null)
  }

  const sendCode = useMutation({
    mutationFn: (toPhone: string) => requestPhoneOtp(toPhone),
    onSuccess: () => {
      setError(null)
      setStep('otp')
      start(RESEND_COOLDOWN_SECONDS)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const verify = useMutation({
    mutationFn: (otp: string) => verifyPhoneOtp(candidate, otp),
    onSuccess: () => {
      clear()
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      toast({ variant: 'success', title: 'Phone number verified' })
      reset()
    },
    onError: (err) => setError(getErrorMessage(err, 'Invalid code. Please try again.')),
  })

  const onCodeChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 6)
    setCode(cleaned)
    setError(null)
    if (cleaned.length === 6 && !verify.isPending) verify.mutate(cleaned)
  }

  if (step === 'view') {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-muted text-sm">Phone</p>
            <p className="text-sm font-medium">{phone ?? '—'}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCandidate(phone ?? '')
              setStep('enter')
            }}
          >
            <Pencil className="size-4" /> {phone ? 'Change' : 'Add'}
          </Button>
        </div>
      </Card>
    )
  }

  if (step === 'enter') {
    return (
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (candidate.trim()) sendCode.mutate(candidate.trim())
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="phone-candidate">Phone</Label>
            <Input
              id="phone-candidate"
              type="tel"
              inputMode="tel"
              placeholder="10-digit mobile number"
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
            />
            <p className="text-muted text-label mt-1.5">We'll text a 6-digit code to confirm it.</p>
          </div>
          {error && (
            <p role="alert" className="text-label text-danger-ink">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={sendCode.isPending} disabled={!candidate.trim()}>
              Send code
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    )
  }

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (code.length === 6) verify.mutate(code)
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="phone-otp">Verification code</Label>
          <p className="text-muted text-label mb-1.5">
            Sent to <span className="font-medium text-[var(--fg)]">{candidate}</span>
          </p>
          <Input
            id="phone-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="max-w-[10rem] text-center text-lg tracking-[0.5em]"
            value={code}
            disabled={verify.isPending}
            onChange={(e) => onCodeChange(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-label text-danger-ink">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" loading={verify.isPending} disabled={code.length !== 6}>
            Verify
          </Button>
          <button
            type="button"
            onClick={() => sendCode.mutate(candidate)}
            disabled={sendCode.isPending || cooldown > 0}
            className="text-accent-ink text-label min-h-9 font-medium disabled:opacity-50"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </button>
          <button
            type="button"
            onClick={() => setStep('enter')}
            className="text-muted text-label min-h-9 font-medium"
          >
            Change number
          </button>
        </div>
      </form>
    </Card>
  )
}
