import enum
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.core.permissions import (
    CASE_APPROVE_FINAL,
    CASE_DECIDE,
    CASE_DRAFT,
    CASE_HOLD,
    CASE_REQUEST_REVISION,
    CASE_SUBMIT,
    CASE_VIEW_ALL,
    QUOTE_CREATE,
)
from app.models.case import Case, CaseStatus
from app.models.document import CaseDocument
from app.models.message import MessageKind
from app.models.quote import QuoteStatus
from app.models.revision import RevisionRequest, RevisionStatus
from app.models.user import User
from app.schemas.case import CaseCreate, CaseUpdate
from app.services import audit_service, document_service, message_service, notification_service, storage_service


class Actor(str, enum.Enum):
    SUBMITTER = "submitter"  # the junior who owns the case
    REVIEWER = "reviewer"    # the advocate
    SYSTEM = "system"        # a confirmed payment (webhook), never a person


@dataclass(frozen=True)
class Transition:
    actor: Actor
    # Permission a human actor must hold; None for SYSTEM moves.
    permission: str | None


# Every legal status change, in one place (docs/NEW_FLOW_SPEC.md §3). A move
# that isn't listed here cannot happen, whoever asks and from wherever.
TRANSITIONS: dict[tuple[CaseStatus, CaseStatus], Transition] = {
    (CaseStatus.DRAFT, CaseStatus.SUBMITTED): Transition(Actor.SUBMITTER, CASE_SUBMIT),
    (CaseStatus.SUBMITTED, CaseStatus.REVIEW_FEE_PAID): Transition(Actor.SYSTEM, None),
    (CaseStatus.REVIEW_FEE_PAID, CaseStatus.ACCEPTED): Transition(Actor.REVIEWER, CASE_DECIDE),
    (CaseStatus.REVIEW_FEE_PAID, CaseStatus.REJECTED): Transition(Actor.REVIEWER, CASE_DECIDE),
    (CaseStatus.ACCEPTED, CaseStatus.QUOTED): Transition(Actor.REVIEWER, QUOTE_CREATE),
    # Replacing the draft or the price while it is still unpaid.
    (CaseStatus.QUOTED, CaseStatus.QUOTED): Transition(Actor.REVIEWER, QUOTE_CREATE),
    (CaseStatus.QUOTED, CaseStatus.DELIVERED): Transition(Actor.SYSTEM, None),
    (CaseStatus.DELIVERED, CaseStatus.REVISION_REQUESTED): Transition(
        Actor.SUBMITTER, CASE_REQUEST_REVISION
    ),
    (CaseStatus.REVISION_REQUESTED, CaseStatus.DELIVERED): Transition(Actor.REVIEWER, CASE_DRAFT),
    (CaseStatus.DELIVERED, CaseStatus.COMPLETED): Transition(Actor.SUBMITTER, CASE_APPROVE_FINAL),
    # Held over: the advocate pauses a case that is waiting on them (e.g. for a
    # court date), and resumes it to exactly where it was (`held_from`).
    (CaseStatus.ACCEPTED, CaseStatus.HELD_OVER): Transition(Actor.REVIEWER, CASE_HOLD),
    (CaseStatus.REVISION_REQUESTED, CaseStatus.HELD_OVER): Transition(Actor.REVIEWER, CASE_HOLD),
    (CaseStatus.HELD_OVER, CaseStatus.ACCEPTED): Transition(Actor.REVIEWER, CASE_HOLD),
    (CaseStatus.HELD_OVER, CaseStatus.REVISION_REQUESTED): Transition(Actor.REVIEWER, CASE_HOLD),
}


def _sources_of(to: CaseStatus) -> list[str]:
    return sorted({src.value for (src, dst) in TRANSITIONS if dst == to})


def assert_can_transition(case: Case, to: CaseStatus) -> Transition:
    entry = TRANSITIONS.get((case.status, to))
    if entry is None:
        expected = _sources_of(to)
        hint = f" (expected: {', '.join(expected)})" if expected else ""
        raise ConflictError(
            f"Cannot move a case from '{case.status.value}' to '{to.value}'{hint}"
        )
    return entry


def transition(case: Case, to: CaseStatus, *, by: User | None) -> None:
    """Move `case` to `to` if the table allows it and `by` is allowed to.
    Pass by=None for SYSTEM moves (payment webhook)."""
    entry = assert_can_transition(case, to)
    if entry.actor is Actor.SYSTEM and by is not None:
        # Edges a payment takes (submitted -> review_fee_paid, quoted ->
        # delivered) must never be reachable by a person, whatever they hold.
        raise ForbiddenError("Only a confirmed payment can move a case there")
    if entry.permission is not None:
        if by is None or entry.permission not in (by.role.permissions or []):
            raise ForbiddenError(f"You don't have the '{entry.permission}' permission for this")
    case.status = to


async def _next_case_number(db: AsyncSession) -> str:
    seq = (await db.execute(func.nextval("case_number_seq"))).scalar_one()
    year = datetime.now(timezone.utc).year
    return f"LF-{year}-{seq:04d}"


async def create_case(db: AsyncSession, *, junior_lawyer: User, data: CaseCreate) -> Case:
    case = Case(
        junior_lawyer_id=junior_lawyer.id,
        case_number=await _next_case_number(db),
        title=data.title,
        case_type=data.case_type,
        court=data.court,
        description=data.description,
        note=data.note,
        # Not visible to the advocate and not payable until the lawyer has added
        # files and submitted it.
        status=CaseStatus.DRAFT,
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
        .options(selectinload(Case.documents), selectinload(Case.payments), selectinload(Case.quotes))
        .where(Case.id == case_id)
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise NotFoundError("Case not found")
    return case


async def lock_case(db: AsyncSession, case_id: uuid.UUID) -> Case:
    """Take a row lock on the case for the rest of the transaction, so a quote
    being replaced and the payment for it landing can't interleave. Refreshes
    the case (and, via the caller, anything it reads next) from the database."""
    result = await db.execute(
        select(Case).where(Case.id == case_id).with_for_update()
        .execution_options(populate_existing=True)
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise NotFoundError("Case not found")
    return case


# Whose move each status is: the lawyer's or the advocate's. Rejected and
# completed cases are nobody's.
_TURN_SIDE = {
    CaseStatus.DRAFT: Actor.SUBMITTER, CaseStatus.SUBMITTED: Actor.SUBMITTER,
    CaseStatus.REVIEW_FEE_PAID: Actor.REVIEWER, CaseStatus.ACCEPTED: Actor.REVIEWER,
    CaseStatus.QUOTED: Actor.SUBMITTER, CaseStatus.DELIVERED: Actor.SUBMITTER,
    CaseStatus.REVISION_REQUESTED: Actor.REVIEWER,
    # Held over is the advocate's to resume, but nobody has anything to do now.
}


def turn_for(case: Case, user: User) -> str:
    """"you" if the ball is in this viewer's court, "them" if in the other
    party's, "none" if nobody's (or the viewer is neither party)."""
    side = _TURN_SIDE.get(case.status)
    if side is None:
        return "none"
    if case.junior_lawyer_id == user.id:
        return "you" if side is Actor.SUBMITTER else "them"
    permissions = user.role.permissions or []
    if CASE_DECIDE in permissions or CASE_DRAFT in permissions:
        return "you" if side is Actor.REVIEWER else "them"
    return "none"


def visible_cases_query(user: User):
    """The cases `user` may list. A draft is its owner's private work: nobody
    else sees it, whatever they hold."""
    query = select(Case)
    if CASE_VIEW_ALL in (user.role.permissions or []):
        return query.where(or_(Case.status != CaseStatus.DRAFT, Case.junior_lawyer_id == user.id))
    return query.where(Case.junior_lawyer_id == user.id)


def authorize_case_access(case: Case, user: User) -> None:
    if case.status == CaseStatus.DRAFT and case.junior_lawyer_id != user.id:
        # Not "forbidden": for anyone else a draft simply doesn't exist yet.
        raise NotFoundError("Case not found")
    if CASE_VIEW_ALL in (user.role.permissions or []):
        return
    if case.junior_lawyer_id != user.id:
        raise ForbiddenError("You may only access your own cases")


def touch(case: Case) -> None:
    # Force an UPDATE so `updated_at` moves even when no column changed: a
    # draft that is still being worked on must not look abandoned.
    case.updated_at = func.now()


def _require_draft(case: Case) -> None:
    if case.status != CaseStatus.DRAFT:
        raise ConflictError("Only a case that hasn't been submitted can be changed this way")


async def update_draft(db: AsyncSession, *, case: Case, data: CaseUpdate) -> Case:
    _require_draft(case)
    for field, value in data.model_dump(exclude_unset=True).items():
        # title and case_type are required columns; ignore an explicit null.
        if value is None and field in {"title", "case_type"}:
            continue
        setattr(case, field, value)
    touch(case)
    await db.flush()
    return case


async def submit_case(db: AsyncSession, *, case: Case, user: User) -> Case:
    """Draft -> submitted, once at least one file is confirmed. The lawyer pays
    the review fee next; the advocate still can't see the case until then."""
    require_owner(case, user)
    if await document_service.count_originals(db, case.id) < 1:
        raise ConflictError("Add at least one file before submitting the case")
    transition(case, CaseStatus.SUBMITTED, by=user)
    await audit_service.log_action(
        db, user_id=user.id, action="case.submitted",
        entity_type="case", entity_id=str(case.id),
    )
    return case


async def discard_draft(db: AsyncSession, *, case: Case, user: User | None) -> None:
    """Delete a never-submitted case and everything uploaded to it. Used when a
    lawyer starts over and by the worker for drafts nobody came back to."""
    _require_draft(case)
    if user is not None:
        require_owner(case, user)
    # Sweep the whole prefix, not just filed documents: a file that was uploaded
    # but never confirmed is in the store too.
    await storage_service.delete_prefix(f"cases/{case.id}/")
    await audit_service.log_action(
        db, user_id=user.id if user else None, action="case.draft_discarded",
        entity_type="case", entity_id=str(case.id),
    )
    await db.delete(case)
    await db.flush()


def require_owner(case: Case, user: User) -> None:
    """For actions only the lawyer who filed the case may take. authorize_case_access
    is broader (it also admits anyone with case:view_all, who may read but not
    speak for the owner)."""
    if case.junior_lawyer_id != user.id:
        raise ForbiddenError("Only the lawyer who filed this case can do that")


def can_open_drafts(case: Case, user: User) -> bool:
    """Drafts are the advocate's work product. The advocate always has them;
    the junior only once a quote for the case has been paid (and not refunded).
    Ownership is checked separately by authorize_case_access."""
    permissions = user.role.permissions or []
    if CASE_DRAFT in permissions or CASE_VIEW_ALL in permissions:
        return True
    return any(q.status == QuoteStatus.PAID for q in case.quotes)


async def decide_case(
    db: AsyncSession, *, case: Case, admin: User, accept: bool, rejection_reason: str | None,
) -> Case:
    # Its own source status too: held_over -> accepted is a legal move, but it
    # is a resume, not a decision.
    if case.status != CaseStatus.REVIEW_FEE_PAID:
        raise ConflictError(
            f"Only a case whose review fee is paid can be decided (current: '{case.status.value}')"
        )
    transition(case, CaseStatus.ACCEPTED if accept else CaseStatus.REJECTED, by=admin)
    if not accept:
        case.rejection_reason = rejection_reason or "No reason provided"
        message = "Your case was reviewed and was not accepted for filing."
        if case.rejection_reason != "No reason provided":
            message += f" Reason: {case.rejection_reason}"
    else:
        message = "Your case was accepted. The advocate will send you a draft and a price."

    await audit_service.log_action(
        db, user_id=admin.id, action=f"case.{case.status.value}",
        entity_type="case", entity_id=str(case.id),
        metadata={"rejection_reason": case.rejection_reason} if not accept else None,
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id, message=message,
        case_id=case.id, kind="case_accepted" if accept else "case_rejected",
    )
    if accept:
        # The first line of the chat, which opens with acceptance.
        await message_service.post_event(
            db, case=case, kind=MessageKind.SYSTEM, actor=admin, meta={"event": "accepted"},
            body="The advocate accepted this case. You can discuss the details here.",
        )
    return case


async def deliver_revised_draft(
    db: AsyncSession, *, case: Case, admin: User, storage_key: str, filename: str,
) -> CaseDocument:
    """Upload a new draft version after the junior asked for changes. The quote
    was already paid, so this needs no payment: the junior can download at once."""
    # Not just "is delivered reachable": quoted -> delivered exists too, but only
    # for a confirmed payment. A new version without payment is for a case whose
    # quote was already paid and whose lawyer asked for changes.
    if case.status != CaseStatus.REVISION_REQUESTED:
        raise ConflictError(
            "A new draft version can only be uploaded while changes are requested "
            f"(current: '{case.status.value}')"
        )
    doc = await document_service.register_draft(
        db, case=case, uploader=admin, storage_key=storage_key, filename=filename,
    )
    transition(case, CaseStatus.DELIVERED, by=admin)

    pending = await db.execute(
        select(RevisionRequest).where(
            RevisionRequest.case_id == case.id, RevisionRequest.status == RevisionStatus.PENDING,
        )
    )
    for request in pending.scalars().all():
        request.status = RevisionStatus.RESOLVED

    await audit_service.log_action(
        db, user_id=admin.id, action="case.draft_revised",
        entity_type="case", entity_id=str(case.id), metadata={"version": doc.version},
    )
    await message_service.post_event(
        db, case=case, kind=MessageKind.DRAFT, actor=admin, body=f"New draft version: v{doc.version}",
        meta={
            "document_id": str(doc.id), "version": doc.version, "filename": doc.original_filename,
            "page_count": doc.page_count, "size_bytes": doc.size_bytes,
        },
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id,
        message=f"A new version of the draft for '{case.title}' is ready to download.",
        case_id=case.id, kind="draft_revised",
    )
    return doc


async def request_revision(
    db: AsyncSession, *, case: Case, junior_lawyer: User, reason: str,
) -> Case:
    """Ask the advocate for changes. Free: the price of the draft already
    covers revisions (chat replaces the old paid-revision dialog)."""
    # Only from a delivered draft; held_over -> revision_requested is a resume.
    if case.status != CaseStatus.DELIVERED:
        raise ConflictError(
            f"Changes can only be asked for on a delivered draft (current: '{case.status.value}')"
        )
    transition(case, CaseStatus.REVISION_REQUESTED, by=junior_lawyer)
    case.revision_count += 1
    db.add(RevisionRequest(case_id=case.id, requested_by=junior_lawyer.id, reason=reason))

    await audit_service.log_action(
        db, user_id=junior_lawyer.id, action="case.revision_requested",
        entity_type="case", entity_id=str(case.id), metadata={"reason": reason},
    )
    await message_service.post_event(
        db, case=case, kind=MessageKind.SYSTEM, actor=junior_lawyer,
        body=f"Changes requested: {reason}", meta={"event": "changes_requested"},
    )
    await notification_service.notify_reviewers(
        db, message=f"Changes requested on '{case.title}': {reason}",
        case_id=case.id, kind="revision_requested",
    )
    return case


async def approve_case(db: AsyncSession, *, case: Case, junior_lawyer: User) -> Case:
    transition(case, CaseStatus.COMPLETED, by=junior_lawyer)

    await audit_service.log_action(
        db, user_id=junior_lawyer.id, action="case.completed",
        entity_type="case", entity_id=str(case.id),
    )
    await message_service.post_event(
        db, case=case, kind=MessageKind.SYSTEM, actor=junior_lawyer, meta={"event": "completed"},
        body="The lawyer approved the draft. This case is complete and the chat is now read-only.",
    )
    return case


async def hold_over(db: AsyncSession, *, case: Case, admin: User, reason: str) -> Case:
    """Pause a case that is waiting on the advocate. The chat stays open."""
    held_from = case.status
    transition(case, CaseStatus.HELD_OVER, by=admin)
    case.held_from = held_from
    case.hold_reason = reason

    await audit_service.log_action(
        db, user_id=admin.id, action="case.held_over",
        entity_type="case", entity_id=str(case.id),
        metadata={"reason": reason, "from": held_from.value},
    )
    await message_service.post_event(
        db, case=case, kind=MessageKind.SYSTEM, actor=admin, meta={"event": "held_over"},
        body=f"The advocate held this case over: {reason}",
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id,
        message=f"'{case.title}' is held over: {reason}",
        case_id=case.id, kind="case_held_over",
    )
    return case


async def resume(db: AsyncSession, *, case: Case, admin: User) -> Case:
    """Take a held-over case back to where it was."""
    if case.status != CaseStatus.HELD_OVER or case.held_from is None:
        raise ConflictError("Only a case that is held over can be resumed")
    transition(case, case.held_from, by=admin)
    case.held_from = None
    case.hold_reason = None

    await audit_service.log_action(
        db, user_id=admin.id, action="case.resumed",
        entity_type="case", entity_id=str(case.id), metadata={"to": case.status.value},
    )
    await message_service.post_event(
        db, case=case, kind=MessageKind.SYSTEM, actor=admin, meta={"event": "resumed"},
        body="The advocate resumed work on this case.",
    )
    await notification_service.notify(
        db, user_id=case.junior_lawyer_id,
        message=f"Work on '{case.title}' has resumed.",
        case_id=case.id, kind="case_resumed",
    )
    return case
