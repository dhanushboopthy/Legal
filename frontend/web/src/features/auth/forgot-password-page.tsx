import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { AuthLayout } from '@/components/layout/auth-layout'
import { destinationFor } from '@/auth/destination'
import { Button } from '@/components/ui/button'
import { Field, Input, PasswordInput } from '@/components/ui/input'
import { usePageTitle } from '@/hooks/use-page-title'
import { forgotPassword } from '@/lib/api/auth'
import { getErrorMessage } from '@/lib/errors'

const PASSWORD_RULES = 'At least 10 characters. A short phrase you will remember works well.'

/** Two steps on one page: ask for a code, then use it to set a new password. */
export function ForgotPasswordPage() {
  usePageTitle('Reset your password')
  const location = useLocation()
  const [email, setEmail] = useState(
    (location.state as { email?: string } | null)?.email ?? '',
  )
  const [step, setStep] = useState<'email' | 'code'>('email')

  return (
    <AuthLayout
      icon={KeyRound}
      title="Reset your password"
      subtitle={
        step === 'email'
          ? "Enter the email you use for this account. We'll email you a 6-digit code."
          : `We sent a 6-digit code to ${email}. It works for 10 minutes.`
      }
      footer={
        <Link to="/login" className="text-accent-ink font-medium hover:underline">
          Back to sign in
        </Link>
      }
    >
      {step === 'email' ? (
        <EmailStep email={email} onEmail={setEmail} onSent={() => setStep('code')} />
      ) : (
        <CodeStep email={email} onChangeEmail={() => setStep('email')} />
      )}
    </AuthLayout>
  )
}

function EmailStep({
  email,
  onEmail,
  onSent,
}: {
  email: string
  onEmail: (email: string) => void
  onSent: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter the email address you signed up with, for example name@example.com.')
      return
    }
    setError(null)
    setSending(true)
    try {
      await forgotPassword(email.trim())
      onSent()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field id="email" label="Email" error={error ?? undefined}>
        {(control) => (
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={sending}>
        Email me a code
      </Button>
    </form>
  )
}

function CodeStep({ email, onChangeEmail }: { email: string; onChangeEmail: () => void }) {
  const { resetPassword } = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resent, setResent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from the email.')
      return
    }
    if (password.length < 10) {
      setError('Your new password needs at least 10 characters.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const user = await resetPassword(email, code, password)
      navigate(destinationFor(user), { replace: true })
    } catch (err) {
      setError(getErrorMessage(err))
      setSaving(false)
    }
  }

  async function resend() {
    setError(null)
    try {
      await forgotPassword(email)
      setResent(true)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field id="code" label="6-digit code from the email">
        {(control) => (
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            // Pasting "123 456" or "Code: 123456" still works.
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="text-center text-2xl tracking-[0.4em]"
            {...control}
          />
        )}
      </Field>
      <Field id="new-password" label="New password" hint={PASSWORD_RULES}>
        {(control) => (
          <PasswordInput
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...control}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="text-danger-ink text-sm font-medium">
          {error}
        </p>
      )}
      {resent && !error && (
        <p role="status" className="text-success-ink text-sm font-medium">
          We sent a new code. Use the newest email.
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={saving}>
        Save new password and sign in
      </Button>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => void resend()}>
          Send a new code
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onChangeEmail}>
          Use a different email
        </Button>
      </div>
    </form>
  )
}
