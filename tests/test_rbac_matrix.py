"""Who may do what, checked exhaustively rather than by example (task 1.7).

Matrix A: for every endpoint, every kind of user, in a state where the action
is valid — the right people succeed and everyone else is refused with 403.
Matrix B: for every action, every case status — only the valid status
succeeds, and a refused action leaves the case exactly as it was.
"""
from dataclasses import dataclass, field
from typing import Callable

import pytest
from sqlalchemy import select

from app.models.case import Case, CaseStatus
from app.models.payment import PaymentStatus, PaymentType
from app.models.quote import QuoteStatus
from tests.conftest import auth_header, make_case, make_pdf, make_user
from tests.helpers import seed_original, seed_payment, seed_quote

ROLE_OF = {
    "owner": "junior_lawyer", "other_lawyer": "junior_lawyer", "advocate": "super_admin",
    "clerk": "clerk", "accountant": "accountant",
}
HAS_QUOTE = {CaseStatus.QUOTED, CaseStatus.DELIVERED, CaseStatus.REVISION_REQUESTED, CaseStatus.COMPLETED}


@dataclass
class World:
    users: dict
    case: Case
    original_id: object = None
    draft_id: object = None
    review_payment_id: object = None
    quote_payment_id: object = None
    paid_payment_id: object = None
    store: object = None


async def build_world(db_session, status, fake_store) -> World:
    users = {actor: await make_user(db_session, role_name=role) for actor, role in ROLE_OF.items()}
    case = await make_case(db_session, users["owner"], status=status)
    world = World(users=users, case=case, store=fake_store)
    world.original_id = (await seed_original(db_session, case, uploader=users["owner"])).id

    if status == CaseStatus.SUBMITTED:
        world.review_payment_id = (await seed_payment(db_session, case, order_id="order_review")).id
    if status in HAS_QUOTE:
        quote = await seed_quote(
            db_session, case, admin=users["advocate"],
            status=QuoteStatus.OPEN if status == CaseStatus.QUOTED else QuoteStatus.PAID,
        )
        world.draft_id = quote.draft_document_id
        if status == CaseStatus.QUOTED:
            world.quote_payment_id = (await seed_payment(
                db_session, case, type=PaymentType.QUOTE, amount=2500, quote=quote, order_id="order_quote",
            )).id
        else:
            world.paid_payment_id = (await seed_payment(
                db_session, case, type=PaymentType.QUOTE, amount=2500, quote=quote,
                status=PaymentStatus.PAID, order_id="order_paid", payment_id="pay_paid",
            )).id
    return world


def pdf_body(world: World, **extra) -> dict:
    key = world.store.put_pdf(world.case)
    return {"draft": {"storage_key": key, "original_filename": "draft.pdf"}, "amount_inr": 2500, **extra}


def confirm_body(world: World) -> dict:
    key = world.store.put(f"cases/{world.case.id}/new.pdf", make_pdf(1))
    return {"case_id": str(world.case.id), "files": [{"storage_key": key, "original_filename": "new.pdf"}]}


def draft_only(world: World) -> dict:
    return {"storage_key": world.store.put_pdf(world.case), "original_filename": "v2.pdf"}


@dataclass
class Endpoint:
    name: str
    method: str
    path: Callable[[World], str]
    status: CaseStatus
    allowed: tuple[str, ...]
    body: Callable[[World], dict] | None = None
    needs_razorpay: bool = False


def _case(w): return f"/cases/{w.case.id}"


ENDPOINTS = [
    Endpoint("review payment", "POST", lambda w: _case(w) + "/review-payment", CaseStatus.SUBMITTED, ("owner",), needs_razorpay=True),
    Endpoint("decide", "PATCH", lambda w: _case(w) + "/decision", CaseStatus.REVIEW_FEE_PAID, ("advocate",), lambda w: {"accept": True}),
    Endpoint("send quote", "POST", lambda w: _case(w) + "/quote", CaseStatus.ACCEPTED, ("advocate",), pdf_body),
    Endpoint("pay quote", "POST", lambda w: _case(w) + "/quote/pay", CaseStatus.QUOTED, ("owner",), needs_razorpay=True),
    Endpoint("upload revised draft", "POST", lambda w: _case(w) + "/drafts", CaseStatus.REVISION_REQUESTED, ("advocate",), draft_only),
    Endpoint("request changes", "POST", lambda w: _case(w) + "/revision", CaseStatus.DELIVERED, ("owner",), lambda w: {"reason": "please fix the annexure"}),
    Endpoint("approve", "POST", lambda w: _case(w) + "/approve", CaseStatus.DELIVERED, ("owner",)),
    Endpoint("read case", "GET", _case, CaseStatus.DELIVERED, ("owner", "advocate", "clerk")),
    Endpoint("read quote", "GET", lambda w: _case(w) + "/quote", CaseStatus.QUOTED, ("owner", "advocate", "clerk")),
    Endpoint("read revisions", "GET", lambda w: _case(w) + "/revisions", CaseStatus.DELIVERED, ("owner", "advocate", "clerk")),
    Endpoint("list documents", "GET", lambda w: f"/documents/case/{w.case.id}", CaseStatus.DELIVERED, ("owner", "advocate", "clerk")),
    Endpoint("download original", "GET", lambda w: f"/documents/{w.original_id}/download-url", CaseStatus.DELIVERED, ("owner", "advocate", "clerk")),
    Endpoint("download paid draft", "GET", lambda w: f"/documents/{w.draft_id}/download-url", CaseStatus.DELIVERED, ("owner", "advocate", "clerk")),
    Endpoint("download unpaid draft", "GET", lambda w: f"/documents/{w.draft_id}/download-url", CaseStatus.QUOTED, ("advocate", "clerk")),
    Endpoint("payments of a case", "GET", lambda w: f"/payments/case/{w.case.id}", CaseStatus.QUOTED, ("owner", "advocate", "clerk")),
    Endpoint("check payment status", "POST", lambda w: f"/payments/{w.quote_payment_id}/reconcile", CaseStatus.QUOTED, ("owner", "advocate", "clerk"), needs_razorpay=True),
    Endpoint("all payments", "GET", lambda w: "/payments", CaseStatus.QUOTED, ("advocate", "accountant")),
    Endpoint("refund", "POST", lambda w: f"/payments/{w.paid_payment_id}/refund", CaseStatus.DELIVERED, ("advocate",), needs_razorpay=True),
    Endpoint("upload url: draft", "POST", lambda w: "/documents/upload-url", CaseStatus.ACCEPTED, ("advocate",),
             lambda w: {"case_id": str(w.case.id), "filename": "d.pdf"}),
    Endpoint("upload urls", "POST", lambda w: "/documents/upload-urls", CaseStatus.DRAFT, ("owner",),
             lambda w: {"case_id": str(w.case.id), "files": [
                 {"filename": "a.pdf", "content_type": "application/pdf", "size": 1000}]}),
    Endpoint("confirm batch", "POST", lambda w: "/documents/confirm-batch", CaseStatus.DRAFT, ("owner",), confirm_body),
    Endpoint("remove file", "DELETE", lambda w: f"/documents/{w.original_id}", CaseStatus.DRAFT, ("owner",)),
    Endpoint("edit draft", "PATCH", _case, CaseStatus.DRAFT, ("owner",), lambda w: {"title": "A better title"}),
    Endpoint("submit", "POST", lambda w: _case(w) + "/submit", CaseStatus.DRAFT, ("owner",)),
    Endpoint("discard draft", "DELETE", _case, CaseStatus.DRAFT, ("owner",)),
]


async def _call(client, world, endpoint, actor):
    body = endpoint.body(world) if endpoint.body else None
    return await client.request(
        endpoint.method, endpoint.path(world), json=body, headers=auth_header(world.users[actor]),
    )


@pytest.mark.parametrize("endpoint", ENDPOINTS, ids=lambda e: e.name)
async def test_matrix_a_only_the_right_people_get_through(client, db_session, fake_store, fake_razorpay, endpoint):
    world = await build_world(db_session, endpoint.status, fake_store)

    # Refused actors first: a refusal must not depend on, or change, any state.
    refused = [a for a in ROLE_OF if a not in endpoint.allowed]
    for actor in refused:
        resp = await _call(client, world, endpoint, actor)
        assert resp.status_code == 403, f"{endpoint.name} as {actor}: expected 403, got {resp.status_code} {resp.text}"

    for actor in endpoint.allowed:
        resp = await _call(client, world, endpoint, actor)
        assert 200 <= resp.status_code < 300, f"{endpoint.name} as {actor}: got {resp.status_code} {resp.text}"


# --- Matrix B ------------------------------------------------------------------

@dataclass
class Action:
    name: str
    actor: str
    valid_in: set[CaseStatus]
    endpoint: Endpoint = field(repr=False)


def _endpoint(name: str) -> Endpoint:
    return next(e for e in ENDPOINTS if e.name == name)


ACTIONS = [
    Action("review payment", "owner", {CaseStatus.SUBMITTED}, _endpoint("review payment")),
    Action("decide", "advocate", {CaseStatus.REVIEW_FEE_PAID}, _endpoint("decide")),
    Action("send quote", "advocate", {CaseStatus.ACCEPTED, CaseStatus.QUOTED}, _endpoint("send quote")),
    Action("pay quote", "owner", {CaseStatus.QUOTED}, _endpoint("pay quote")),
    Action("upload revised draft", "advocate", {CaseStatus.REVISION_REQUESTED}, _endpoint("upload revised draft")),
    Action("request changes", "owner", {CaseStatus.DELIVERED}, _endpoint("request changes")),
    Action("approve", "owner", {CaseStatus.DELIVERED}, _endpoint("approve")),
    Action("submit", "owner", {CaseStatus.DRAFT}, _endpoint("submit")),
    Action("edit draft", "owner", {CaseStatus.DRAFT}, _endpoint("edit draft")),
    Action("discard draft", "owner", {CaseStatus.DRAFT}, _endpoint("discard draft")),
    Action("upload urls", "owner", {CaseStatus.DRAFT, CaseStatus.SUBMITTED}, _endpoint("upload urls")),
    Action("confirm batch", "owner", {CaseStatus.DRAFT, CaseStatus.SUBMITTED}, _endpoint("confirm batch")),
]


@pytest.mark.parametrize("status", list(CaseStatus), ids=lambda s: s.value)
@pytest.mark.parametrize("action", ACTIONS, ids=lambda a: a.name)
async def test_matrix_b_an_action_only_works_in_its_own_status(
    client, db_session, fake_store, fake_razorpay, action, status,
):
    world = await build_world(db_session, status, fake_store)
    case_id = world.case.id

    resp = await _call(client, world, action.endpoint, action.actor)

    if status in action.valid_in:
        assert 200 <= resp.status_code < 300, f"{action.name} in {status.value}: {resp.status_code} {resp.text}"
    else:
        assert resp.status_code in (404, 409), f"{action.name} in {status.value}: {resp.status_code} {resp.text}"
        db_session.expire_all()
        unchanged = (await db_session.execute(select(Case.status).where(Case.id == case_id))).scalar_one()
        assert unchanged == status, "a refused action must leave the case where it was"
        assert fake_razorpay.orders == [], "a refused action must not create a payment order"
