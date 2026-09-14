import { zodResolver } from '@hookform/resolvers/zod'
import { isAxiosError } from 'axios'
import { Briefcase } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { FieldError, Input, Label } from '@/components/ui/input'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})
type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (values: FormValues) => {
    setError(null)
    try {
      await login(values.email, values.password)
      const from = (location.state as { from?: Location })?.from
      navigate(from?.pathname ?? '/', { replace: true })
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 403) {
        setError('Your account is pending admin approval.')
      } else if (isAxiosError(err) && err.response?.status === 401) {
        setError('Incorrect email or password.')
      } else {
        setError('Something went wrong. Please try again.')
      }
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

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
              autoComplete="current-password"
              {...register('password')}
            />
            <FieldError>{errors.password?.message}</FieldError>
          </div>
          {error && <p className="text-[13px] text-[var(--color-danger)]">{error}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Sign in
          </Button>
        </form>

        <p className="text-muted mt-6 text-center text-sm">
          New here?{' '}
          <Link to="/register" className="font-medium text-[var(--color-accent)]">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  )
}
