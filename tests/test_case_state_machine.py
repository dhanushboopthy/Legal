from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.core.exceptions import ConflictError, ForbiddenError
from app.core.permissions import ROLE_PERMISSIONS
from app.models.case import Case, CaseStatus
from app.models.notification import Notification
from app.models.revision import RevisionRequest, RevisionStatus
from app.schemas.case import CaseCreate
from app.services import case_service
from app.services.case_service import TRANSITIONS, Actor
from tests.conftest import make_case, make_user

ALL = list(CaseStatus)


def _user(*permissions: str):
    return SimpleNamespace(role=SimpleNamespace(permissions=list(permissions)))


# --- the transition table itself ----------------------------------------

@pytest.mark.parametrize("src", ALL, ids=lambda s: s.value)
@pytest.mark.parametrize("dst", ALL, ids=lambda s: s.value)
def test_a_move_is_allowed_exactly_when_the_table_lists_it(src, dst):
    case = Case(status=src)
    if (src, dst) in TRANSITIONS:
        assert case_service.assert_can_transition(case, dst) is TRANSITIONS[(src, dst)]
    else:
        with pytest.raises(ConflictError):
            case_service.assert_can_transition(case, dst)


def test_closed_cases_have_no_way_out():
    for terminal in (CaseStatus.REJECTED, CaseStatus.COMPLETED):
        assert not [dst for (src, dst) in TRANSITIONS if src == terminal]


def test_every_status_is_reachable_from_draft():
    seen, frontier = {CaseStatus.DRAFT}, [CaseStatus.DRAFT]
    while frontier:
        here = frontier.pop()
        for (src, dst) in TRANSITIONS:
            if src == here and dst not in seen:
                seen.add(dst)
                frontier.append(dst)
    assert seen == set(CaseStatus)


def test_only_a_confirmed_payment_moves_money_gated_edges():
    """Paying is the sole trigger for review_fee_paid and delivered-from-quoted,
    and it is done by the system, not by a person with a permission."""
    for edge in (
        (CaseStatus.SUBMITTED, CaseStatus.REVIEW_FEE_PAID),
        (CaseStatus.QUOTED, CaseStatus.DELIVERED),
    ):
        assert TRANSITIONS[edge].actor is Actor.SYSTEM
        assert TRANSITIONS[edge].permission is None


@pytest.mark.parametrize(
    "edge", [e for e, t in TRANSITIONS.items() if t.actor is Actor.SYSTEM], ids=lambda x: str(x)
)
def test_no_person_can_take_a_payment_edge_whatever_they_hold(edge):
    everything = _user(*{p for perms in ROLE_PERMISSIONS.values() for p in perms})
    case = Case(status=edge[0])
    with pytest.raises(ForbiddenError):
        case_service.transition(case, edge[1], by=everything)
    assert case.status == edge[0]
    case_service.transition(case, edge[1], by=None)  # only the payment path (by=None) may
    assert case.status == edge[1]


@pytest.mark.parametrize(
    "edge,entry", [(e, t) for e, t in TRANSITIONS.items() if t.permission], ids=lambda x: str(x)
)
def test_a_person_needs_the_edges_permission(edge, entry):
    src, dst = edge
    with pytest.raises(ForbiddenError):
        case_service.transition(Case(status=src), dst, by=_user())
    with pytest.raises(ForbiddenError):
        case_service.transition(Case(status=src), dst, by=None)

    case = Case(status=src)
    case_service.transition(case, dst, by=_user(entry.permission))
    assert case.status == dst


@pytest.mark.parametrize(
    "role,edge",
    [(role, edge) for role in ROLE_PERMISSIONS for edge, t in TRANSITIONS.items() if t.permission],
    ids=lambda x: str(x),
)
def test_default_roles_can_only_take_the_edges_meant_for_them(role, edge):
    """super_admin drives the advocate's edges, junior_lawyer the submitter's,
    and the read-only roles none of them."""
    entry = TRANSITIONS[edge]
    holds = entry.permission in ROLE_PERMISSIONS[role]
    expected = {
        Actor.REVIEWER: role == "super_admin",
        Actor.SUBMITTER: role == "junior_lawyer",
    }[entry.actor]
    assert holds == expected


# --- the actions built on it --------------------------------------------

async def _case(db_session, lawyer, status=CaseStatus.SUBMITTED):
    case = await case_service.create_case(
        db_session, junior_lawyer=lawyer, data=CaseCreate(title="Test case", case_type="civil"),
    )
    case.status = status
    return case


async def test_decide_case_requires_review_fee_paid_status(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await _case(db_session, lawyer)  # still SUBMITTED

    with pytest.raises(ConflictError):
        await case_service.decide_case(
            db_session, case=case, admin=admin, accept=True, rejection_reason=None,
        )


async def test_decide_case_cannot_run_twice(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await _case(db_session, lawyer, CaseStatus.REVIEW_FEE_PAID)

    case = await case_service.decide_case(
        db_session, case=case, admin=admin, accept=True, rejection_reason=None,
    )
    assert case.status == CaseStatus.ACCEPTED

    with pytest.raises(ConflictError):
        await case_service.decide_case(
            db_session, case=case, admin=admin, accept=True, rejection_reason=None,
        )


async def test_decide_case_reject_sets_reason_and_tells_the_lawyer_why(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await _case(db_session, lawyer, CaseStatus.REVIEW_FEE_PAID)

    case = await case_service.decide_case(
        db_session, case=case, admin=admin, accept=False, rejection_reason="Not enough evidence",
    )
    assert case.status == CaseStatus.REJECTED
    assert case.rejection_reason == "Not enough evidence"

    await db_session.commit()
    notes = (await db_session.execute(
        select(Notification).where(Notification.user_id == lawyer.id)
    )).scalars().all()
    assert "Not enough evidence" in notes[0].message  # F-16: the reason used to be omitted
    assert notes[0].case_id == case.id and notes[0].kind == "case_rejected"


async def test_request_revision_is_free_needs_delivered_and_is_visible_to_the_advocate(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await _case(db_session, lawyer, CaseStatus.DELIVERED)

    case = await case_service.request_revision(
        db_session, case=case, junior_lawyer=lawyer, reason="Please add the FIR annexure",
    )
    assert case.status == CaseStatus.REVISION_REQUESTED
    assert case.revision_count == 1

    await db_session.commit()
    request = (await db_session.execute(select(RevisionRequest))).scalar_one()
    assert request.reason == "Please add the FIR annexure"
    assert request.status == RevisionStatus.PENDING

    # The advocate is told, with the reason (F-03, F-04).
    note = (await db_session.execute(
        select(Notification).where(Notification.user_id == admin.id)
    )).scalar_one()
    assert "Please add the FIR annexure" in note.message and note.kind == "revision_requested"


@pytest.mark.parametrize("status", [s for s in ALL if s != CaseStatus.DELIVERED], ids=lambda s: s.value)
async def test_request_revision_only_from_delivered(db_session, status):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await _case(db_session, lawyer, status)
    with pytest.raises(ConflictError):
        await case_service.request_revision(
            db_session, case=case, junior_lawyer=lawyer, reason="too early",
        )


async def test_approve_case_marks_completed(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await _case(db_session, lawyer, CaseStatus.DELIVERED)
    case = await case_service.approve_case(db_session, case=case, junior_lawyer=lawyer)
    assert case.status == CaseStatus.COMPLETED


@pytest.mark.parametrize("status", [s for s in ALL if s != CaseStatus.DELIVERED], ids=lambda s: s.value)
async def test_approve_only_from_delivered(db_session, status):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await _case(db_session, lawyer, status)
    with pytest.raises(ConflictError):
        await case_service.approve_case(db_session, case=case, junior_lawyer=lawyer)


async def test_a_completed_case_stays_completed(db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await make_case(db_session, lawyer, status=CaseStatus.COMPLETED)
    with pytest.raises(ConflictError):
        case_service.transition(case, CaseStatus.REVIEW_FEE_PAID, by=None)
