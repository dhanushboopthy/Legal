import { Compass } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { StatusPage } from '@/components/ui/status-page'

export function NotFoundPage({
  inline = false,
  title = 'Page not found',
  description = "The page you're looking for doesn't exist or may have moved.",
}: {
  inline?: boolean
  title?: string
  description?: string
}) {
  const navigate = useNavigate()
  return (
    <StatusPage
      inline={inline}
      icon={Compass}
      code="404"
      title={title}
      description={description}
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Go back
          </Button>
          <Link to="/" className={buttonVariants({ variant: 'primary', size: 'md' })}>
            Back to dashboard
          </Link>
        </>
      }
    />
  )
}
