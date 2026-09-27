import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Field, Input, PasswordInput } from '@/components/ui/input'
import { register as registerAccount } from '@/lib/api/auth'
import { getErrorMessage } from '@/lib/errors'
import { usePageTitle } from '@/hooks/use-page-title'

const schema = z.object({
  full_name: z.string().min(2, 'Enter your full name').max(150),
  email: z.string().email('Enter a valid email address'),
  bar_council_id: z
    .string()
    .trim()
    .min(3, 'Enter your Bar Council enrolment number')
    .max(100, 'Use at most 100 characters'),
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
    <AuthLayout
      title="Create your account"
      subtitle="For lawyers filing cases with the practice."
      footer={
        <p>
          Already have an account?{' '}
          <Link to="/login" className="text-accent-ink font-medium hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Field id="full_name" label="Full name" error={errors.full_name?.message}>
          {(control) => <Input autoComplete="name" {...control} {...register('full_name')} />}
        </Field>
        <Field id="email" label="Email" error={errors.email?.message}>
          {(control) => <Input type="email" autoComplete="email" {...control} {...register('email')} />}
        </Field>
        <Field
          id="bar_council_id"
          label="Bar Council enrolment number"
          hint="As printed on your enrolment certificate, for example MAH/1234/2015."
          error={errors.bar_council_id?.message}
        >
          {(control) => <Input autoComplete="off" {...control} {...register('bar_council_id')} />}
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
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
