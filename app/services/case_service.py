import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.core.permissions import CASE_VIEW_ALL
from app.models.case import Case, CaseStatus
from app.models.document import CaseDocument, DocumentType
from app.models.revision import RevisionRequest, RevisionStatus
from app.models.user import User
from app.schemas.case import CaseCreate
from app.services import audit_service, notification_service

# Valid status a case must be in before a given transition is allowed.
_REQUIRES_STATUS_FOR = {
    "decide": {CaseStatus.REVIEW_FEE_PAID},
    "deliver_draft": {CaseStatus.DRAFTING_FEE_PAID, CaseStatus.REVISION_REQUESTED},
    "request_revision": {CaseStatus.DRAFT_DELIVERED},
    "approve": {CaseStatus.DRAFT_DELIVERED},
}


async def create_case(db: AsyncSession, *, junior_lawyer: User, data: CaseCreate) -> Case:
    case = Case(
        junior_lawyer_id=junior_lawyer.id,
        title=data.title,
        case_type=data.case_type,
        court=data.court,
        description=data.description,
        status=CaseStatus.SUBMITTED,
    )
    db.add(case)
    await db.flush()
    await audit_service.log_action(
        db, user_id=junior_lawyer.id, action="case.created",
        entity_type="case", entity_id=str(case.id),
    )
    return case


async def get_case_or_404(db: AsyncSession, case_id: uuid.UUID) -> Case:
    result = await db.execute(
        select(Case)
        .options(selectinload(Case.documents), selectinload(Case.payments))
        .where(Case.id == case_id)
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise NotFoundError("Case not found")
    return case


def authorize_case_access(case: Case, user: User) -> None:
    if CASE_VIEW_ALL in (user.role.permissions or []):
        return
    if case.junior_lawyer_id != user.id:
        raise ForbiddenError("You may only access your own cases")


def _assert_status(case: Case, action: str) -> None:
    allowed = _REQUIRES_STATUS_FOR[action]
    if case.status not in allowed:
        raise ConflictError(
            f"Cannot perform '{action}' while case status is '{case.status.value}' "
            f"(expected one of: {', '.join(s.value for s in allowed)})"
        )


async def decide_case(
    db: AsyncSession, *, case: Case, admin: User, accept: bool, rejection_reason: str | None,
) -> Case:
    _assert_status(case, "decide")
    if not accept:
        case.status = CaseStatus.REJECTED
        case.rejection_reason = rejection_reason or "No reason provided"
        message = "Your case was reviewed and was not accepted for filing."
    else:
        case.status = CaseStatus.ACCEPTED
        message = "Your case was accepted. A drafting fee is now required to proceed."

    await audit_service.log_action(
        db, user_id=admin.id, action=f"case.{case.status.value}",
        entity_type="case", entity_id=str(case.id),
        metadata={"rejection_reason": case.rejection_reason} if not accept else None,
    )
    await notification_service.notify(db, user_id=case.junior_lawyer_id, message=message)
    return case


async def deliver_draft(
    db: AsyncSession, *, case: Case, admin: User, storage_key: str, filename: str,
) -> CaseDocument:
    _assert_status(case, "deliver_draft")

    # If this delivery is resolving a revision, close out the pending request first.
    if case.status == CaseStatus.REVISION_REQUESTED:
        result = await db.execute(
            select(RevisionRequest).where(
                RevisionRequest.case_id == case.id,
                RevisionRequest.status == RevisionStatus.PENDING,
            )
        )
        pending = result.scalars().first()
        if pending:
            pending.status = RevisionStatus.RESOLVED

    next_version = case.revision_count + 1
    doc = CaseDocument(
        case_id=case.id, type=DocumentType.DRAFT, version=next_version,
        storage_key=storage_key, original_filename=filename, uploaded_by=admin.id,
    )
    db.add(doc)
    case.status = CaseStatus.DRAFT_DELIVERED

    await audit_service.log_action(
        db, user_id=admin.id, action="case.draft_delivered",
        entity_type="case", entity_id=str(case.id), metadata={"version": next_version},
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id,
        message="Your filing draft is ready for review.",
    )
    return doc


async def request_revision(
    db: AsyncSession, *, case: Case, junior_lawyer: User, reason: str, free_revisions: int,
) -> tuple[Case, bool]:
    """Returns (case, requires_payment). If requires_payment is True, the
    caller must create a revision-fee payment order before the status advances."""
    _assert_status(case, "request_revision")

    revision = RevisionRequest(case_id=case.id, requested_by=junior_lawyer.id, reason=reason)
    db.add(revision)

    requires_payment = case.revision_count >= free_revisions
    if not requires_payment:
        case.status = CaseStatus.REVISION_REQUESTED
        case.revision_count += 1
        await notification_service.notify(
            db, user_id=case.junior_lawyer_id, message="Revision requested.",
        )

    await audit_service.log_action(
        db, user_id=junior_lawyer.id, action="case.revision_requested",
        entity_type="case", entity_id=str(case.id),
        metadata={"reason": reason, "requires_payment": requires_payment},
    )
    return case, requires_payment


async def approve_case(db: AsyncSession, *, case: Case, junior_lawyer: User) -> Case:
    _assert_status(case, "approve")
    case.status = CaseStatus.COMPLETED

    await audit_service.log_action(
        db, user_id=junior_lawyer.id, action="case.completed",
        entity_type="case", entity_id=str(case.id),
    )
    return case
