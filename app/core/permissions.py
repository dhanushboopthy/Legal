"""
Static RBAC permission map.

Roles are stored in the database (see app.models.role) so new roles can be
added without a code change, but the permission *names* referenced by routes
are defined here as constants, and every role ships with a default permission
set seeded at startup / via migration.
"""

# --- permission constants -----------------------------------------------
CASE_SUBMIT = "case:submit"
CASE_VIEW_OWN = "case:view_own"
CASE_VIEW_ALL = "case:view_all"
CASE_REVIEW = "case:review"
CASE_DECIDE = "case:decide"          # accept / reject
CASE_DRAFT = "case:draft"            # upload draft / final filing
CASE_REQUEST_REVISION = "case:request_revision"
CASE_APPROVE_FINAL = "case:approve_final"
CASE_MESSAGE = "case:message"        # take part in a case's chat (besides its owner)
QUOTE_CREATE = "quote:create"        # price a draft and send it to the junior
CASE_HOLD = "case:hold"              # hold a case over (pause it) and resume it

PAYMENT_INITIATE = "payment:initiate"
PAYMENT_VIEW_OWN = "payment:view_own"
PAYMENT_VIEW_ALL = "payment:view_all"
PAYMENT_REFUND = "payment:refund"

USER_MANAGE = "user:manage"          # approve new junior lawyers, deactivate, etc.
AUDIT_VIEW = "audit:view"

# --- default role -> permission sets (used for seeding) ------------------
ROLE_PERMISSIONS: dict[str, set[str]] = {
    "super_admin": {
        CASE_VIEW_ALL, CASE_REVIEW, CASE_DECIDE, CASE_DRAFT, CASE_MESSAGE, QUOTE_CREATE, CASE_HOLD,
        PAYMENT_VIEW_ALL, PAYMENT_REFUND, USER_MANAGE, AUDIT_VIEW,
    },
    "junior_lawyer": {
        CASE_SUBMIT, CASE_VIEW_OWN, CASE_REQUEST_REVISION, CASE_APPROVE_FINAL,
        PAYMENT_INITIATE, PAYMENT_VIEW_OWN,
    },
    "clerk": {
        CASE_VIEW_ALL,
    },
    "accountant": {
        PAYMENT_VIEW_ALL,
    },
}
