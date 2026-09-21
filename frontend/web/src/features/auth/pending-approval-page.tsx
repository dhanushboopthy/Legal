import { Hourglass } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button-variants'
import { StatusPage } from '@/components/ui/status-page'

// Where a lawyer lands once their email is verified but an admin hasn't
// approved the account yet — instead of being dropped back on the sign-in form.
export function PendingApprovalPage() {
  const email = (useLocation().state as { email?: string } | null)?.email
  return (
    <StatusPage
      icon={Hourglass}
      title="Waiting for admin approval"
      description={`${
        email ? `${email} is verified. ` : 'Your email is verified. '
      }An admin needs to approve your account before you can sign in — you'll be notified as soon as that happens.`}
      actions={
        <Link to="/login" className={buttonVariants({ variant: 'secondary', size: 'md' })}>
          Back to sign in
        </Link>
      }
    />
  )
}
