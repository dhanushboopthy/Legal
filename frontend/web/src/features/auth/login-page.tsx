import { zodResolver } from '@hookform/resolvers/zod'
import { isAxiosError } from 'axios'
import { Briefcase } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { useAuth } from '@/auth/auth-context'
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { isGoogleSignInConfigured } from '@/hooks/use-google-identity'
import { getErrorMessage } from '@/lib/errors'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})
type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const { login, loginWithGoogle } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [googlePending, setGooglePending] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const goToDestination = () => {
    const from = (location.state as { from?: Location })?.from
    navigate(from?.pathname ?? '/', { replace: true })
  }

  // Returns true if the error sent the user to a dedicated page (unverified
  // email / pending approval), so the caller shouldn't also show it inline.
  const redirectForAccountState = (err: unknown, email?: string): boolean => {
    if (!isAxiosError(err) || err.response?.status !== 403) return false
    const detail = String(err.response.data?.detail ?? '').toLowerCase()
    if (detail.includes('verify your email') && email) {
      navigate('/verify-email', { state: { email, resend: true } })
      return true
    }
    if (detail.includes('pending')) {
      navigate('/pending-approval', { state: { email } })
      return true
    }
    return false
  }

  const onSubmit = async (values: FormValues) => {
    setError(null)
    try {
      await login(values.email, values.password)
      goToDestination()
    } catch (err) {
      if (!redirectForAccountState(err, values.email)) setError(getErrorMessage(err))
    }
  }

  const onGoogleCredential = async (idToken: string) => {
    setError(null)
    setGooglePending(true)
    try {
      await loginWithGoogle(idToken)
      goToDestination()
    } catch (err) {
      if (!redirectForAccountState(err)) setError(getErrorMessage(err))
    } finally {
      setGooglePending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-white">
            <Briefcase className="size-6" strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-muted text-sm">Sign in to your case-filing account</p>
        </div>

        {isGoogleSignInConfigured && (
          <>
            <div className="mb-5">
              <GoogleSignInButton onCredential={onGoogleCredential} onError={setError} />
              {googlePending && (
                <p className="text-muted text-label mt-2 text-center">Signing in…</p>
              )}
            </div>

            <div className="mb-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-muted text-caption">or</span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field id="email" label="Email" error={errors.email?.message}>
            {(control) => (
              <Input type="email" autoComplete="email" {...control} {...register('email')} />
            )}
          </Field>
          <Field id="password" label="Password" error={errors.password?.message}>
            {(control) => (
              <Input
                type="password"
                autoComplete="current-password"
                {...control}
                {...register('password')}
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-label text-danger-ink">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Sign in
          </Button>
        </form>

        <p className="text-muted mt-6 text-center text-sm">
          New here?{' '}
          <Link to="/register" className="text-accent-ink font-medium">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  )
}
