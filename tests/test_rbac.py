from tests.conftest import auth_header, make_user


async def test_case_submit_denied_without_permission(client, db_session):
    """super_admin holds CASE_VIEW_ALL/CASE_DECIDE/... but not CASE_SUBMIT."""
    admin = await make_user(db_session, role_name="super_admin")
    resp = await client.post(
        "/cases",
        json={"title": "A case", "case_type": "civil"},
        headers=auth_header(admin),
    )
    assert resp.status_code == 403


async def test_case_submit_allowed_for_junior_lawyer(client, db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    resp = await client.post(
        "/cases",
        json={"title": "A case", "case_type": "civil"},
        headers=auth_header(lawyer),
    )
    assert resp.status_code == 200


async def test_junior_lawyer_cannot_view_another_lawyers_case(client, db_session):
    owner = await make_user(db_session, role_name="junior_lawyer")
    other = await make_user(db_session, role_name="junior_lawyer")

    create = await client.post(
        "/cases",
        json={"title": "Owner's case", "case_type": "civil"},
        headers=auth_header(owner),
    )
    case_id = create.json()["id"]

    resp = await client.get(f"/cases/{case_id}", headers=auth_header(other))
    assert resp.status_code == 403


async def test_case_view_all_permission_bypasses_ownership_check(client, db_session):
    owner = await make_user(db_session, role_name="junior_lawyer")
    clerk = await make_user(db_session, role_name="clerk")

    create = await client.post(
        "/cases",
        json={"title": "Owner's case", "case_type": "civil"},
        headers=auth_header(owner),
    )
    case_id = create.json()["id"]

    resp = await client.get(f"/cases/{case_id}", headers=auth_header(clerk))
    assert resp.status_code == 200


async def test_only_junior_lawyer_can_initiate_payment_even_with_view_all(client, db_session):
    """Regression test: a clerk has CASE_VIEW_ALL (passes ownership check) but
    must still be denied at the payment-initiation endpoint since only
    junior_lawyer holds PAYMENT_INITIATE."""
    owner = await make_user(db_session, role_name="junior_lawyer")
    clerk = await make_user(db_session, role_name="clerk")

    create = await client.post(
        "/cases",
        json={"title": "Owner's case", "case_type": "civil"},
        headers=auth_header(owner),
    )
    case_id = create.json()["id"]

    resp = await client.post(f"/cases/{case_id}/review-payment", headers=auth_header(clerk))
    assert resp.status_code == 403
