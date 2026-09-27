import { zodResolver } from '@hookform/resolvers/zod'
import { Briefcase } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Field, Input, PasswordInput } from '@/components/ui/input'
import { register as registerAccount } from '@/lib/api/auth'
import { getErrorMessage } from '@/lib/errors'
import { usePageTitle } from '@/hooks/use-page-title'

const schema = z.object({
  full_name: z.string().min(2, 'Enter your full name').max(150),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(10, 'Use at least 10 characters.').max(72, 'Use at most 72 characters.'),
})
type FormValues = z.infer<typeof schema>

export function RegisterPage() {
  usePageTitle('Create an account')
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (values: FormValues) => {
    setError(null)
    try {
      await registerAccount(values)
      navigate('/verify-email', { state: { email: values.email } })
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
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-muted text-center text-sm">For lawyers submitting cases</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field id="full_name" label="Full name" error={errors.full_name?.message}>
            {(control) => <Input autoComplete="name" {...control} {...register('full_name')} />}
          </Field>
          <Field id="email" label="Email" error={errors.email?.message}>
            {(control) => (
              <Input type="email" autoComplete="email" {...control} {...register('email')} />
            )}
          </Field>
          <Field
            id="password"
            label="Password"
            hint="At least 10 characters. A short phrase of three or four words you will remember works well."
            error={errors.password?.message}
          >
            {(control) => (
              <PasswordInput autoComplete="new-password" {...control} {...register('password')} />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-danger-ink text-sm font-medium">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Create account
          </Button>
        </form>

        <p className="text-muted mt-6 text-center text-sm">
          Already have an account?{' '}
          <Link to="/login" className="text-accent-ink font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
