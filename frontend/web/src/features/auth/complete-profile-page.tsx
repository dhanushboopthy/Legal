import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { useAuth } from '@/auth/auth-context'
import { destinationFor } from '@/auth/destination'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { PageSpinner } from '@/components/ui/page-spinner'
import { updateMe } from '@/lib/api/users'
import { getErrorMessage } from '@/lib/errors'
import { usePageTitle } from '@/hooks/use-page-title'

const schema = z.object({
  bar_council_id: z.string().trim().min(3, 'Enter your Bar Council enrolment number'),
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
    <AuthLayout
      title="One more thing"
      subtitle="Your Bar Council enrolment number, so the advocate can verify you."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Field
          id="bar_council_id"
          label="Bar Council enrolment number"
          hint="As printed on your enrolment certificate, for example MAH/1234/2015."
          error={errors.bar_council_id?.message}
        >
          {(control) => <Input autoComplete="off" {...control} {...register('bar_council_id')} />}
        </Field>
        {error && (
          <p role="alert" className="text-danger-ink text-sm font-medium">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Continue
        </Button>
      </form>
    </AuthLayout>
  )
}
