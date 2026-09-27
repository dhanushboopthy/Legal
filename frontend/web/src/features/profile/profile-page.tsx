import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TextSizeControl } from '@/components/ui/text-size-control'
import { useToast } from '@/components/ui/toast-context'
import { getErrorMessage } from '@/lib/errors'
import { getMe, updateMe } from '@/lib/api/users'
import type { UserOut } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'
import { BackLink } from '@/components/layout/back-link'

const schema = z.object({
  bar_council_id: z.string().trim().max(100).optional().or(z.literal('')),
})
type FormValues = z.infer<typeof schema>

export function ProfilePage() {
  usePageTitle('Your profile')
  const { data: user, isLoading } = useQuery({ queryKey: ['me'], queryFn: getMe })
  const { hash } = useLocation()

  // "Text size" in the account menu lands here.
  useEffect(() => {
    if (user && hash === '#text-size') {
      document.getElementById('text-size')?.scrollIntoView({ block: 'center' })
    }
  }, [user, hash])

  if (isLoading || !user) return <Skeleton className="h-48 max-w-md" />

  return (
    <div className="mx-auto max-w-xl">
      <BackLink to="/">All cases</BackLink>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Your profile</h1>
      <Card>
        <dl className="divide-y divide-[var(--border)]">
          <Row label="Full name" value={user.full_name} />
          <Row label="Email" value={user.email} />
          <Row label="Role" value={roleLabel(user.role_name)} />
          <Row label="Status" value={user.is_active ? 'Active' : 'Pending approval'} />
        </dl>
      </Card>
      <div className="mt-4">
        <EditableFields user={user} />
      </div>
      <Card className="mt-4">
        <div id="text-size" className="scroll-mt-24">
          <TextSizeControl />
          <p className="text-muted mt-3 text-sm">
            Makes all text and buttons bigger on this device. You can change it at any time.
          </p>
        </div>
      </Card>
    </div>
  )
}

// Display only, never used to decide what someone may do.
const ROLE_LABELS: Record<string, string> = {
  junior_lawyer: 'Lawyer',
  super_admin: 'Advocate',
  clerk: 'Clerk',
  accountant: 'Accountant',
}

function roleLabel(roleName: string): string {
  return ROLE_LABELS[roleName] ?? roleName.replace(/_/g, ' ')
}

function EditableFields({ user }: { user: UserOut }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: { bar_council_id: user.bar_council_id ?? '' },
  })

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      updateMe({ bar_council_id: values.bar_council_id || undefined }),
    onSuccess: () => {
      toast({ variant: 'success', title: 'Profile updated' })
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      setEditing(false)
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: "Couldn't save your profile",
        description: getErrorMessage(err),
      }),
  })

  if (!editing) {
    return (
      <Card>
        <dl className="divide-y divide-[var(--border)]">
          <Row label="Bar Council enrolment number" value={user.bar_council_id ?? 'Not added yet'} />
        </dl>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setEditing(true)}>
          <Pencil className="size-4" aria-hidden /> Edit enrolment number
        </Button>
      </Card>
    )
  }

  return (
    <Card>
      <form
        onSubmit={handleSubmit((values) => save.mutate(values))}
        className="space-y-4"
      >
        <Field
          id="bar_council_id"
          label="Bar Council enrolment number"
          hint="As printed on your enrolment certificate, for example MAH/1234/2015."
          error={errors.bar_council_id?.message}
        >
          {(control) => <Input {...control} {...register('bar_council_id')} />}
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={save.isPending}>
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              reset()
              setEditing(false)
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="text-sm font-semibold break-all">{value}</dd>
    </div>
  )
}
