import pytest

from app.core.exceptions import ConflictError
from app.models.case import CaseStatus
from app.schemas.case import CaseCreate
from app.services import case_service
from tests.conftest import make_user


async def _submitted_case(db_session, lawyer):
    return await case_service.create_case(
        db_session, junior_lawyer=lawyer,
        data=CaseCreate(title="Test case", case_type="civil"),
    )


async def test_decide_case_requires_review_fee_paid_status(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await _submitted_case(db_session, lawyer)

    # Still SUBMITTED, not REVIEW_FEE_PAID yet.
    with pytest.raises(ConflictError):
        await case_service.decide_case(
            db_session, case=case, admin=admin, accept=True, rejection_reason=None,
        )


async def test_decide_case_cannot_run_twice(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await _submitted_case(db_session, lawyer)
    case.status = CaseStatus.REVIEW_FEE_PAID

    case = await case_service.decide_case(
        db_session, case=case, admin=admin, accept=True, rejection_reason=None,
    )
    assert case.status == CaseStatus.ACCEPTED

    with pytest.raises(ConflictError):
        await case_service.decide_case(
            db_session, case=case, admin=admin, accept=True, rejection_reason=None,
        )


async def test_decide_case_reject_sets_reason(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await _submitted_case(db_session, lawyer)
    case.status = CaseStatus.REVIEW_FEE_PAID

    case = await case_service.decide_case(
        db_session, case=case, admin=admin, accept=False, rejection_reason="Not enough evidence",
    )
    assert case.status == CaseStatus.REJECTED
    assert case.rejection_reason == "Not enough evidence"


async def test_request_revision_free_quota_then_requires_payment(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await _submitted_case(db_session, lawyer)
    case.status = CaseStatus.DRAFT_DELIVERED
    case.revision_count = 0

    case, requires_payment = await case_service.request_revision(
        db_session, case=case, junior_lawyer=lawyer, reason="Fix typo", free_revisions=1,
    )
    assert requires_payment is False
    assert case.status == CaseStatus.REVISION_REQUESTED
    assert case.revision_count == 1

    # Back to draft_delivered (as if a new draft were delivered) and ask again —
    # the free quota (1) is now exhausted.
    case.status = CaseStatus.DRAFT_DELIVERED
    case, requires_payment = await case_service.request_revision(
        db_session, case=case, junior_lawyer=lawyer, reason="Fix again", free_revisions=1,
    )
    assert requires_payment is True
    # Status is NOT advanced until the revision fee is paid.
    assert case.status == CaseStatus.DRAFT_DELIVERED


async def test_request_revision_requires_draft_delivered_status(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await _submitted_case(db_session, lawyer)

    with pytest.raises(ConflictError):
        await case_service.request_revision(
            db_session, case=case, junior_lawyer=lawyer, reason="too early", free_revisions=1,
        )


async def test_approve_case_requires_draft_delivered_status(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await _submitted_case(db_session, lawyer)

    with pytest.raises(ConflictError):
        await case_service.approve_case(db_session, case=case, junior_lawyer=lawyer)


async def test_approve_case_marks_completed(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await _submitted_case(db_session, lawyer)
    case.status = CaseStatus.DRAFT_DELIVERED

    case = await case_service.approve_case(db_session, case=case, junior_lawyer=lawyer)
    assert case.status == CaseStatus.COMPLETED
