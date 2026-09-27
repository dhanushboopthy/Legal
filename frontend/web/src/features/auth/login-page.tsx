import { zodResolver } from '@hookform/resolvers/zod'
import { isAxiosError } from 'axios'
import { Briefcase } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { useAuth } from '@/auth/auth-context'
import { destinationFor } from '@/auth/destination'
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button'
import { Button } from '@/components/ui/button'
import { Field, Input, PasswordInput } from '@/components/ui/input'
import { ContactCard } from '@/features/help/help-page'
import { isGoogleSignInConfigured } from '@/hooks/use-google-identity'
import { getErrorMessage } from '@/lib/errors'
import type { UserOut } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})
type FormValues = z.infer<typeof schema>

export function LoginPage() {
  usePageTitle('Sign in')
  const { login, loginWithGoogle, status, user: sessionUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [googlePending, setGooglePending] = useState(false)

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  // A verified-but-not-yet-approved account still signs in (a limited
  // session — see useAuth().status 'pending'), and a signup with no Bar
  // Council ID yet goes to collect one; only a fully set-up, active account
  // goes on to wherever it was headed, query and hash intact.
  const routeSignedInUser = (user: UserOut) => {
    const destination = destinationFor(user)
    if (destination !== '/') {
      navigate(destination, { replace: true })
      return
    }
    const from = (location.state as { from?: Location })?.from
    navigate(from ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}` : '/', {
      replace: true,
    })
  }

  // True if the error sent the user to verify their email instead, so the
  // caller shouldn't also show it inline.
  const redirectIfUnverified = (err: unknown, email?: string): boolean => {
    if (!isAxiosError(err) || err.response?.status !== 403 || !email) return false
    const detail = String(err.response.data?.detail ?? '').toLowerCase()
    if (!detail.includes('verify your email')) return false
    navigate('/verify-email', { state: { email, resend: true } })
    return true
  }

  const onSubmit = async (values: FormValues) => {
    setError(null)
    try {
      routeSignedInUser(await login(values.email, values.password))
    } catch (err) {
      if (!redirectIfUnverified(err, values.email)) setError(getErrorMessage(err))
    }
  }

  const onGoogleCredential = async (idToken: string) => {
    setError(null)
    setGooglePending(true)
    try {
      routeSignedInUser(await loginWithGoogle(idToken))
    } catch (err) {
      if (!redirectIfUnverified(err)) setError(getErrorMessage(err))
    } finally {
      setGooglePending(false)
    }
  }

  // Landed here with a session already: nothing to do here. Checked after
  // every hook above runs, so hook order stays the same on every render.
  if (sessionUser && status !== 'unauthenticated') {
    return <Navigate to={destinationFor(sessionUser)} replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-md">
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
              <span className="text-muted text-sm">or</span>
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
              <PasswordInput
                autoComplete="current-password"
                {...control}
                {...register('password')}
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-danger-ink text-sm font-medium">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Sign in
          </Button>
          <p className="text-center">
            <Link
              to="/forgot-password"
              state={{ email: getValues('email') }}
              className="text-accent-ink inline-flex min-h-11 items-center text-sm font-semibold hover:underline"
            >
              Forgot password?
            </Link>
          </p>
        </form>

        <p className="mt-6 text-center text-sm">
          New here?{' '}
          <Link to="/register" className="text-accent-ink font-semibold hover:underline">
            Create an account
          </Link>
        </p>

        <ContactCard />
      </div>
    </div>
  )
}
