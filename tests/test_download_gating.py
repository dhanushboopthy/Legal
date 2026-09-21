import pytest

from app.models.case import CaseStatus
from app.models.quote import QuoteStatus
from tests.conftest import auth_header, make_case, make_user
from tests.helpers import seed_draft, seed_original, seed_quote


async def _case_with_files(db_session, *, status=CaseStatus.QUOTED, quote_status=QuoteStatus.OPEN):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=status)
    original = await seed_original(db_session, case, uploader=lawyer)
    quote = await seed_quote(db_session, case, admin=admin, status=quote_status)
    draft_id = quote.draft_document_id
    return lawyer, admin, case, original, draft_id, quote


async def _download(client, user, doc_id):
    return await client.get(f"/documents/{doc_id}/download-url", headers=auth_header(user))


async def test_the_lawyer_can_always_download_their_own_original(client, db_session, fake_store):
    lawyer, admin, case, original, draft_id, quote = await _case_with_files(db_session)
    resp = await _download(client, lawyer, original.id)
    assert resp.status_code == 200 and "download_url" in resp.json()


async def test_an_unpaid_draft_has_no_download_link_for_the_lawyer(client, db_session, fake_store):
    lawyer, admin, case, original, draft_id, quote = await _case_with_files(db_session)
    resp = await _download(client, lawyer, draft_id)
    assert resp.status_code == 403 and resp.json() == {"detail": "payment_required"}


async def test_an_unpaid_draft_is_listed_as_locked_and_never_exposes_its_key(client, db_session, fake_store):
    lawyer, admin, case, original, draft_id, quote = await _case_with_files(db_session)
    resp = await client.get(f"/documents/case/{case.id}", headers=auth_header(lawyer))
    assert resp.status_code == 200
    assert "storage_key" not in resp.text and "cases/" not in resp.text

    by_type = {d["type"]: d for d in resp.json()}
    assert by_type["draft"]["locked"] is True
    assert by_type["original"]["locked"] is False
    # Enough to recognise the file (D2) without being able to open it.
    assert (by_type["draft"]["original_filename"], by_type["draft"]["page_count"]) == ("draft_v1.pdf", 3)
    assert by_type["draft"]["size_bytes"] and by_type["draft"]["created_at"]


async def test_the_advocate_always_sees_and_downloads_drafts(client, db_session, fake_store):
    lawyer, admin, case, original, draft_id, quote = await _case_with_files(db_session)
    listing = (await client.get(f"/documents/case/{case.id}", headers=auth_header(admin))).json()
    assert all(d["locked"] is False for d in listing)
    assert (await _download(client, admin, draft_id)).status_code == 200


async def test_a_clerk_with_view_all_can_open_drafts_too(client, db_session, fake_store):
    lawyer, admin, case, original, draft_id, quote = await _case_with_files(db_session)
    clerk = await make_user(db_session, role_name="clerk")
    assert (await _download(client, clerk, draft_id)).status_code == 200


async def test_paying_unlocks_every_version(client, db_session, fake_store):
    lawyer, admin, case, original, draft_id, quote = await _case_with_files(
        db_session, status=CaseStatus.DELIVERED, quote_status=QuoteStatus.PAID,
    )
    later = await seed_draft(db_session, case, uploader=admin, version=2)

    listing = (await client.get(f"/documents/case/{case.id}", headers=auth_header(lawyer))).json()
    assert all(d["locked"] is False for d in listing)
    for doc_id in (draft_id, later.id):
        assert (await _download(client, lawyer, doc_id)).status_code == 200


@pytest.mark.parametrize("status", [CaseStatus.DELIVERED, CaseStatus.REVISION_REQUESTED, CaseStatus.COMPLETED])
async def test_a_paid_draft_stays_downloadable_through_revisions_and_after_completion(client, db_session, fake_store, status):
    lawyer, admin, case, original, draft_id, quote = await _case_with_files(
        db_session, status=status, quote_status=QuoteStatus.PAID,
    )
    assert (await _download(client, lawyer, draft_id)).status_code == 200


async def test_a_refund_takes_the_download_back(client, db_session, fake_store):
    lawyer, admin, case, original, draft_id, quote = await _case_with_files(
        db_session, status=CaseStatus.DELIVERED, quote_status=QuoteStatus.REFUNDED,
    )
    resp = await _download(client, lawyer, draft_id)
    assert resp.status_code == 403 and resp.json() == {"detail": "payment_required"}
    listing = (await client.get(f"/documents/case/{case.id}", headers=auth_header(lawyer))).json()
    assert {d["type"]: d["locked"] for d in listing}["draft"] is True


async def test_a_superseded_quote_does_not_unlock_anything(client, db_session, fake_store):
    lawyer, admin, case, original, draft_id, quote = await _case_with_files(
        db_session, quote_status=QuoteStatus.SUPERSEDED,
    )
    assert (await _download(client, lawyer, draft_id)).status_code == 403


async def test_another_lawyer_cannot_get_any_file_of_the_case(client, db_session, fake_store):
    lawyer, admin, case, original, draft_id, quote = await _case_with_files(
        db_session, status=CaseStatus.DELIVERED, quote_status=QuoteStatus.PAID,
    )
    stranger = await make_user(db_session, role_name="junior_lawyer")
    for doc_id in (original.id, draft_id):
        assert (await _download(client, stranger, doc_id)).status_code == 403
    assert (await client.get(f"/documents/case/{case.id}", headers=auth_header(stranger))).status_code == 403


async def test_an_unknown_document_is_a_404(client, db_session, fake_store):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    resp = await _download(client, lawyer, "00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


# --- uploads and confirming --------------------------------------------------

async def test_confirm_files_only_an_original_and_only_before_review(client, db_session, fake_store):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await make_case(db_session, lawyer, status=CaseStatus.SUBMITTED)
    ok = await client.post("/documents/confirm", headers=auth_header(lawyer), json={
        "case_id": str(case.id), "storage_key": f"cases/{case.id}/a.pdf",
        "original_filename": "a.pdf", "document_type": "original",
    })
    assert ok.status_code == 200 and ok.json()["locked"] is False

    as_draft = await client.post("/documents/confirm", headers=auth_header(lawyer), json={
        "case_id": str(case.id), "storage_key": f"cases/{case.id}/b.pdf",
        "original_filename": "b.pdf", "document_type": "draft",
    })
    assert as_draft.status_code == 422 and "quote" in as_draft.json()["detail"]

    case.status = CaseStatus.ACCEPTED
    await db_session.commit()
    late = await client.post("/documents/confirm", headers=auth_header(lawyer), json={
        "case_id": str(case.id), "storage_key": f"cases/{case.id}/c.pdf",
        "original_filename": "c.pdf", "document_type": "original",
    })
    assert late.status_code == 422


async def test_a_junior_cannot_get_an_upload_url_for_a_draft(client, db_session, fake_store):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    admin = await make_user(db_session, role_name="super_admin")
    case = await make_case(db_session, lawyer, status=CaseStatus.ACCEPTED)
    payload = {"case_id": str(case.id), "filename": "d.pdf", "document_type": "draft"}
    assert (await client.post("/documents/upload-url", json=payload, headers=auth_header(lawyer))).status_code == 403
    assert (await client.post("/documents/upload-url", json=payload, headers=auth_header(admin))).status_code == 200


async def test_the_supporting_type_is_not_uploadable_yet(client, db_session, fake_store):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    case = await make_case(db_session, lawyer)
    resp = await client.post(
        "/documents/upload-url", headers=auth_header(lawyer),
        json={"case_id": str(case.id), "filename": "x.pdf", "document_type": "supporting"},
    )
    assert resp.status_code == 422
