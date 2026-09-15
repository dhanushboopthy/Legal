import { zodResolver } from '@hookform/resolvers/zod'
import { isAxiosError } from 'axios'
import { Briefcase, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FieldError, Input, Label } from '@/components/ui/input'
import { OtpStep } from '@/features/auth/otp-step'
import { register as registerAccount } from '@/lib/api/auth'

const schema = z.object({
  full_name: z.string().min(2, 'Enter your full name').max(150),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'At least 8 characters').max(128),
  phone: z.string().optional(),
  bar_council_id: z.string().optional(),
})
type FormValues = z.infer<typeof schema>

type Step = 'form' | 'otp' | 'done'

export function RegisterPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('form')
  const [registeredEmail, setRegisteredEmail] = useState('')
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
      setRegisteredEmail(values.email)
      setStep('otp')
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 422) {
        setError(err.response.data?.detail ?? 'An account with this email already exists.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    }
  }

  if (step === 'otp') {
    return <OtpStep email={registeredEmail} onVerified={() => setStep('done')} />
  }

  if (step === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <Card className="max-w-sm text-center">
          <CheckCircle2 className="mx-auto mb-4 size-10 text-[var(--color-success)]" />
          <h1 className="mb-2 text-lg font-semibold">Email verified</h1>
          <p className="text-muted mb-6 text-sm">
            An admin still needs to approve your account before you can sign in. You'll be notified
            once that happens.
          </p>
          <Button className="w-full" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-white">
            <Briefcase className="size-6" strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-muted text-center text-sm">For junior lawyers submitting cases</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="full_name">Full name</Label>
            <Input id="full_name" autoComplete="name" {...register('full_name')} />
            <FieldError>{errors.full_name?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            <FieldError>{errors.email?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...register('password')}
            />
            <FieldError>{errors.password?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="bar_council_id">Bar council ID (optional)</Label>
            <Input id="bar_council_id" {...register('bar_council_id')} />
          </div>
          {error && <p className="text-[13px] text-[var(--color-danger)]">{error}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Create account
          </Button>
        </form>

        <p className="text-muted mt-6 text-center text-sm">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-[var(--color-accent)]">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
