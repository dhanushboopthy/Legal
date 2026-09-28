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
import { List, ListRow } from '@/components/ui/list'
import { Skeleton } from '@/components/ui/skeleton'
import { TextSizeControl } from '@/components/ui/text-size-control'
import { useToast } from '@/components/ui/toast-context'
import { getErrorMessage } from '@/lib/errors'
import { getMe, updateMe } from '@/lib/api/users'
import type { UserOut } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'
import { BackLink } from '@/components/layout/back-link'
import { ProfilePhoto } from '@/features/profile/profile-photo'

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
      <h1 className="lg:text-title mb-8 text-2xl font-semibold">Your profile</h1>
      <div className="space-y-8">
        <ProfilePhoto user={user} />
        <List heading="Account">
          <ListRow title="Name" subtitle={user.full_name} />
          <ListRow title="Email" subtitle={<span className="break-all">{user.email}</span>} />
        </List>
        <EditableFields user={user} />
        <section id="text-size" className="scroll-mt-24">
          <Card>
            <TextSizeControl />
            <p className="text-muted mt-3 text-sm">
              Makes all text and buttons bigger on this device. You can change it at any time.
            </p>
          </Card>
        </section>
      </div>
    </div>
  )
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
      <List heading="Bar Council">
        <ListRow
          title="Enrolment number"
          subtitle={user.bar_council_id ?? 'Not added yet'}
          trailing={
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
          }
        />
      </List>
    )
  }

  return (
    <Card>
      <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4">
        <Field
          id="bar_council_id"
          label="Bar Council enrolment number"
          hint="As printed on your enrolment certificate, for example MAH/1234/2015."
          error={errors.bar_council_id?.message}
        >
          {(control) => <Input {...control} {...register('bar_council_id')} />}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
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
