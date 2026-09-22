import type { UserOut } from '@/types/api'

// Where a signed-in user goes next, in the order the gates apply: a Bar
// Council ID first (collected once, for every signup path including
// Google — see docs/UX_REDESIGN_PLAN.md 5.1), then admin approval, then in.
export function destinationFor(user: UserOut): '/complete-profile' | '/pending-approval' | '/' {
  if (!user.bar_council_id) return '/complete-profile'
  if (!user.is_active) return '/pending-approval'
  return '/'
}
