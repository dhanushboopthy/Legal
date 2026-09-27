import { zodResolver } from '@hookform/resolvers/zod'
import { Briefcase } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { useAuth } from '@/auth/auth-context'
import { destinationFor } from '@/auth/destination'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { PageSpinner } from '@/components/ui/page-spinner'
import { updateMe } from '@/lib/api/users'
import { getErrorMessage } from '@/lib/errors'
import { usePageTitle } from '@/hooks/use-page-title'

const schema = z.object({
  bar_council_id: z.string().trim().min(3, 'Enter your Bar Council ID'),
})
type FormValues = z.infer<typeof schema>

// One follow-up step every signup path lands on until it has a Bar Council
// ID — password sign-up (after OTP) and Google sign-up alike, so the
// advocate always has something to verify before approving an account.
export function CompleteProfilePage() {
  usePageTitle('Complete your profile')
  const { user, status, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  if (status === 'loading') return <PageSpinner />
  if (status === 'unauthenticated' || !user) return <Navigate to="/login" replace />
  if (user.bar_council_id) return <Navigate to={destinationFor(user)} replace />

  const onSubmit = async (values: FormValues) => {
    setError(null)
    try {
      await updateMe({ bar_council_id: values.bar_council_id })
      const fresh = await refreshUser()
      navigate(destinationFor(fresh), { replace: true })
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-white">
            <Briefcase className="size-6" strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">One more thing</h1>
          <p className="text-muted text-center text-sm">
            Your Bar Council ID, so the advocate reviewing your cases can verify you.
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Field
              id="bar_council_id"
              label="Bar Council ID"
              error={errors.bar_council_id?.message}
            >
              {(control) => (
                <Input autoComplete="off" {...control} {...register('bar_council_id')} />
              )}
            </Field>
            {error && (
              <p role="alert" className="text-label text-danger-ink">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" loading={isSubmitting}>
              Continue
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
