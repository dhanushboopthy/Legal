// Permission names, mirroring app/core/permissions.py. The API returns the
// signed-in user's list in `/users/me`; gate UI on these, never on role_name.
export const PERMISSIONS = {
  CASE_SUBMIT: 'case:submit',
  CASE_VIEW_OWN: 'case:view_own',
  CASE_VIEW_ALL: 'case:view_all',
  CASE_REVIEW: 'case:review',
  CASE_DECIDE: 'case:decide',
  CASE_DRAFT: 'case:draft',
  CASE_REQUEST_REVISION: 'case:request_revision',
  CASE_APPROVE_FINAL: 'case:approve_final',
  CASE_MESSAGE: 'case:message',
  QUOTE_CREATE: 'quote:create',
  CASE_HOLD: 'case:hold',
  PAYMENT_INITIATE: 'payment:initiate',
  PAYMENT_VIEW_OWN: 'payment:view_own',
  PAYMENT_VIEW_ALL: 'payment:view_all',
  PAYMENT_REFUND: 'payment:refund',
  USER_MANAGE: 'user:manage',
  AUDIT_VIEW: 'audit:view',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export type CanFn = (permission: Permission) => boolean
