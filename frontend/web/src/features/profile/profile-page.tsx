import { useQuery } from '@tanstack/react-query'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getMe } from '@/lib/api/users'

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
          <Row label="Phone" value={user.phone ?? '—'} />
          <Row label="Bar council ID" value={user.bar_council_id ?? '—'} />
          <Row label="Role" value={user.role_name.replace('_', ' ')} />
          <Row label="Status" value={user.is_active ? 'Active' : 'Pending approval'} />
        </dl>
      </Card>
    </div>
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
