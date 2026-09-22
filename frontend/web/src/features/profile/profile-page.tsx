import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast-context'
import { PhoneField } from '@/features/profile/phone-field'
import { getErrorMessage } from '@/lib/errors'
import { getMe, updateMe } from '@/lib/api/users'
import type { UserOut } from '@/types/api'

const schema = z.object({
  bar_council_id: z.string().trim().max(100).optional().or(z.literal('')),
})
type FormValues = z.infer<typeof schema>

export function ProfilePage() {
  const { data: user, isLoading } = useQuery({ queryKey: ['me'], queryFn: getMe })

  if (isLoading || !user) return <Skeleton className="h-48 max-w-md" />

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Profile</h1>
      <Card>
        <dl className="divide-y divide-[var(--border)]">
          <Row label="Full name" value={user.full_name} />
          <Row label="Email" value={user.email} />
          <Row label="Role" value={user.role_name.replace(/_/g, ' ')} />
          <Row label="Status" value={user.is_active ? 'Active' : 'Pending approval'} />
        </dl>
      </Card>
      <div className="mt-4">
        <PhoneField phone={user.phone} />
      </div>
      <div className="mt-4">
        <BarCouncilField user={user} />
      </div>
    </div>
  )
}

function BarCouncilField({ user }: { user: UserOut }) {
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
          <Row label="Bar council ID" value={user.bar_council_id ?? '—'} />
        </dl>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setEditing(true)}>
          <Pencil className="size-4" /> Edit
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
        <Field id="bar_council_id" label="Bar council ID" error={errors.bar_council_id?.message}>
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
    <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="text-sm font-medium capitalize">{value}</dd>
    </div>
  )
}
