import { ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button-variants'
import { StatusPage } from '@/components/ui/status-page'

export function ForbiddenPage({ inline = false }: { inline?: boolean }) {
  return (
    <StatusPage
      inline={inline}
      icon={ShieldAlert}
      code="403"
      title="You don't have access to this page"
      description="Your account's role doesn't allow this. If you think that's a mistake, contact an administrator."
      actions={
        <Link to="/" className={buttonVariants({ variant: 'primary', size: 'md' })}>
          Back to dashboard
        </Link>
      }
    />
  )
}
