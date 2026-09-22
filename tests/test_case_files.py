"""Multi-file intake (docs/NEW_FLOW_SPEC.md §6): a draft case, signed uploads,
verified confirmation, and the submit that hands it to the advocate."""
import asyncio
import uuid

from sqlalchemy import select, text

from app.config import settings
from app.models.case import Case, CaseStatus
from app.models.document import CaseDocument, DocumentType
from tests.conftest import AsyncSessionLocal, auth_header, make_case, make_pdf, make_user
from tests.helpers import seed_draft, seed_original

PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# Real first bytes for each accepted type, padded so they aren't degenerate.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 64
DOCX_BYTES = b"PK\x03\x04" + b"\x00" * 64
DOC_BYTES = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64
SAMPLES = {
    "petition.pdf": make_pdf(1), "notes.docx": DOCX_BYTES, "old.doc": DOC_BYTES,
    "scan.png": PNG_BYTES, "photo.jpg": JPEG_BYTES, "photo2.jpeg": JPEG_BYTES,
}


async def _lawyer_and_draft(db, status=CaseStatus.DRAFT):
    lawyer = await make_user(db, role_name="junior_lawyer")
    return lawyer, await make_case(db, lawyer, status=status)


def _key(case, name):
    return f"cases/{case.id}/{uuid.uuid4()}_{name}"


def _confirm(client, lawyer, case, files):
    return client.post("/documents/confirm-batch", headers=auth_header(lawyer), json={
        "case_id": str(case.id),
        "files": [{"storage_key": k, "original_filename": n} for k, n in files],
    })


def _upload_urls(client, lawyer, case, files):
    return client.post("/documents/upload-urls", headers=auth_header(lawyer), json={
        "case_id": str(case.id),
        "files": [{"filename": n, "content_type": t, "size": s} for n, t, s in files],
    })


async def _originals(db, case):
    # A fresh session, so what is read is what was committed, not what the
    # test's own session happens to have cached.
    case_id = case.id
    async with AsyncSessionLocal() as fresh:
        rows = await fresh.execute(select(CaseDocument).where(
            CaseDocument.case_id == case_id, CaseDocument.type == DocumentType.ORIGINAL))
        return list(rows.scalars().all())


# --- a draft case ------------------------------------------------------------

async def test_a_new_case_starts_as_a_draft_and_cannot_be_paid_for(client, db_session, fake_razorpay):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    created = await client.post("/cases", headers=auth_header(lawyer), json={
        "title": "Bail petition", "case_type": "Criminal"})
    assert created.status_code == 200 and created.json()["status"] == "draft"

    pay = await client.post(f"/cases/{created.json()['id']}/review-payment", headers=auth_header(lawyer))
    assert pay.status_code == 409
    assert fake_razorpay.orders == []


async def test_the_advocate_cannot_see_a_draft_in_any_way(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    doc = await seed_original(db_session, case, uploader=lawyer)
    advocate = await make_user(db_session, role_name="super_admin")
    h = auth_header(advocate)

    listed = (await client.get("/cases", headers=h)).json()
    assert str(case.id) not in {c["id"] for c in listed}
    assert (await client.get(f"/cases/{case.id}", headers=h)).status_code == 404
    assert (await client.get(f"/documents/case/{case.id}", headers=h)).status_code == 404
    assert (await client.get(f"/documents/{doc.id}/download-url", headers=h)).status_code == 404
    # ...while the owner still has it.
    own = (await client.get("/cases", headers=auth_header(lawyer))).json()
    assert str(case.id) in {c["id"] for c in own}


async def test_edit_a_draft_but_not_a_submitted_case(client, db_session):
    lawyer, case = await _lawyer_and_draft(db_session)
    h = auth_header(lawyer)
    ok = await client.patch(f"/cases/{case.id}", headers=h, json={
        "title": "Sharma vs Verma", "case_type": "Civil", "note": "urgent"})
    assert ok.status_code == 200
    assert (ok.json()["title"], ok.json()["case_type"], ok.json()["note"]) == ("Sharma vs Verma", "Civil", "urgent")

    # An explicit null can't blank a required field.
    kept = await client.patch(f"/cases/{case.id}", headers=h, json={"title": None})
    assert kept.status_code == 200 and kept.json()["title"] == "Sharma vs Verma"

    case.status = CaseStatus.SUBMITTED
    await db_session.commit()
    assert (await client.patch(f"/cases/{case.id}", headers=h, json={"title": "Changed"})).status_code == 409


async def test_submit_needs_a_file_and_moves_the_case_on_once(client, db_session, fake_razorpay):
    lawyer, case = await _lawyer_and_draft(db_session)
    h = auth_header(lawyer)

    empty = await client.post(f"/cases/{case.id}/submit", headers=h)
    assert empty.status_code == 409 and "at least one file" in empty.json()["detail"]

    await seed_original(db_session, case, uploader=lawyer)
    ok = await client.post(f"/cases/{case.id}/submit", headers=h)
    assert ok.status_code == 200 and ok.json()["status"] == "submitted"
    assert (await client.post(f"/cases/{case.id}/submit", headers=h)).status_code == 409

    # Now, and only now, the review fee can be paid.
    assert (await client.post(f"/cases/{case.id}/review-payment", headers=h)).status_code == 200


async def test_only_the_owner_can_submit_edit_or_discard(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    await seed_original(db_session, case, uploader=lawyer)
    other = await make_user(db_session, role_name="junior_lawyer")
    h = auth_header(other)
    assert (await client.post(f"/cases/{case.id}/submit", headers=h)).status_code == 403
    assert (await client.patch(f"/cases/{case.id}", headers=h, json={"title": "Mine now"})).status_code == 403
    assert (await client.delete(f"/cases/{case.id}", headers=h)).status_code == 403


async def test_discarding_a_draft_deletes_its_files_even_unconfirmed_ones(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    doc = await seed_original(db_session, case, uploader=lawyer)
    fake_store.put(doc.storage_key, make_pdf(1))
    orphan = fake_store.put(_key(case, "never-confirmed.png"), PNG_BYTES)
    other_case_key = fake_store.put(f"cases/{uuid.uuid4()}/keep.pdf", make_pdf(1))

    resp = await client.delete(f"/cases/{case.id}", headers=auth_header(lawyer))
    assert resp.status_code == 204
    assert orphan not in fake_store.objects and doc.storage_key not in fake_store.objects
    assert other_case_key in fake_store.objects
    async with AsyncSessionLocal() as fresh:
        assert (await fresh.execute(select(Case).where(Case.id == case.id))).scalar_one_or_none() is None


async def test_a_submitted_case_cannot_be_discarded(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session, status=CaseStatus.SUBMITTED)
    assert (await client.delete(f"/cases/{case.id}", headers=auth_header(lawyer))).status_code == 409


# --- upload-urls --------------------------------------------------------------

async def test_five_mixed_files_each_get_a_url_signed_for_their_type_and_size(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    files = [("petition.pdf", PDF, 5000), ("notes.docx", DOCX, 6000), ("old.doc", "application/msword", 7000),
             ("scan.png", "image/png", 8000), ("photo.JPG", "image/jpeg", 9000)]
    resp = await _upload_urls(client, lawyer, case, files)
    assert resp.status_code == 200
    targets = resp.json()["files"]
    assert [t["filename"] for t in targets] == [f[0] for f in files]
    assert len({t["storage_key"] for t in targets}) == 5
    for t, (_, ctype, size) in zip(targets, files):
        assert t["storage_key"].startswith(f"cases/{case.id}/")
        assert f"size={size}" in t["upload_url"] and ctype in t["upload_url"]


async def test_upload_urls_refuses_bad_files_before_anything_is_uploaded(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    mb = 1024 * 1024
    bad = {
        "a type we don't accept": ("run.exe", "application/octet-stream", 100),
        "no extension": ("README", PDF, 100),
        "type that contradicts the extension": ("scan.png", PDF, 100),
        "over the per-file size": ("big.pdf", PDF, (settings.max_file_size_mb + 1) * mb),
        "a control character in the name": ("bad\x00name.pdf", PDF, 100),
    }
    for why, (name, ctype, size) in bad.items():
        resp = await _upload_urls(client, lawyer, case, [(name, ctype, size)])
        assert resp.status_code == 422, why
    for size in (0, -5):
        assert (await _upload_urls(client, lawyer, case, [("a.pdf", PDF, size)])).status_code == 422
    # One bad file refuses the whole request, so nothing is half-signed.
    mixed = await _upload_urls(client, lawyer, case, [("ok.pdf", PDF, 100), ("run.exe", "x/y", 100)])
    assert mixed.status_code == 422 and "run.exe" in mixed.json()["detail"]


async def test_upload_urls_enforces_the_file_count_and_total_size(client, db_session, fake_store, monkeypatch):
    lawyer, case = await _lawyer_and_draft(db_session)
    monkeypatch.setattr(settings, "max_files_per_case", 3)
    monkeypatch.setattr(settings, "max_case_size_mb", 1)
    await seed_original(db_session, case, uploader=lawyer)  # 1234 bytes on file

    over_count = await _upload_urls(client, lawyer, case, [(f"{i}.pdf", PDF, 10) for i in range(3)])
    assert over_count.status_code == 422 and "at most 3 files" in over_count.json()["detail"]
    over_total = await _upload_urls(client, lawyer, case, [("a.pdf", PDF, 1024 * 1024)])
    assert over_total.status_code == 422 and "1 MB" in over_total.json()["detail"]
    assert (await _upload_urls(client, lawyer, case, [("a.pdf", PDF, 1000), ("b.png", "image/png", 1000)])).status_code == 200


async def test_upload_urls_only_before_review_and_only_for_the_owner(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session, status=CaseStatus.SUBMITTED)
    assert (await _upload_urls(client, lawyer, case, [("a.pdf", PDF, 10)])).status_code == 200
    case.status = CaseStatus.ACCEPTED
    await db_session.commit()
    assert (await _upload_urls(client, lawyer, case, [("a.pdf", PDF, 10)])).status_code == 409
    other = await make_user(db_session, role_name="junior_lawyer")
    assert (await _upload_urls(client, other, case, [("a.pdf", PDF, 10)])).status_code == 403


# --- confirm-batch ------------------------------------------------------------

async def test_one_batch_confirms_all_six_accepted_types(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    files = [(fake_store.put(_key(case, n), data), n) for n, data in SAMPLES.items()]

    resp = await _confirm(client, lawyer, case, files)
    assert resp.status_code == 200
    body = resp.json()
    assert body["rejected"] == [] and len(body["confirmed"]) == 6
    by_name = {d["original_filename"]: d for d in body["confirmed"]}
    assert by_name["notes.docx"]["content_type"] == DOCX
    assert by_name["photo2.jpeg"]["content_type"] == "image/jpeg"
    assert by_name["scan.png"]["size_bytes"] == len(PNG_BYTES)
    assert all(d["type"] == "original" and d["locked"] is False for d in body["confirmed"])
    assert "storage_key" not in body["confirmed"][0]
    assert len(await _originals(db_session, case)) == 6


async def test_a_file_that_isnt_what_it_claims_is_rejected_and_deleted_alone(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    good = fake_store.put(_key(case, "petition.pdf"), make_pdf(1))
    fake_png = fake_store.put(_key(case, "scan.png"), make_pdf(1))          # a PDF wearing .png
    fake_pdf = fake_store.put(_key(case, "evil.pdf"), b"MZ\x90\x00" + b"\x00" * 64)
    fake_docx = fake_store.put(_key(case, "notes.docx"), PNG_BYTES)

    resp = await _confirm(client, lawyer, case, [
        (good, "petition.pdf"), (fake_png, "scan.png"), (fake_pdf, "evil.pdf"), (fake_docx, "notes.docx")])
    body = resp.json()
    assert [d["original_filename"] for d in body["confirmed"]] == ["petition.pdf"]
    assert {r["original_filename"] for r in body["rejected"]} == {"scan.png", "evil.pdf", "notes.docx"}
    assert all("look like a real" in r["reason"] for r in body["rejected"])
    assert good in fake_store.objects
    assert not ({fake_png, fake_pdf, fake_docx} & set(fake_store.objects))


async def test_confirm_reports_a_missing_upload_without_failing_the_rest(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    good = fake_store.put(_key(case, "a.pdf"), make_pdf(1))
    resp = await _confirm(client, lawyer, case, [(good, "a.pdf"), (_key(case, "gone.pdf"), "gone.pdf")])
    body = resp.json()
    assert len(body["confirmed"]) == 1
    assert body["rejected"][0]["original_filename"] == "gone.pdf"
    assert "couldn't find" in body["rejected"][0]["reason"]


async def test_confirm_rejects_oversize_and_empty_objects_and_deletes_them(client, db_session, fake_store, monkeypatch):
    lawyer, case = await _lawyer_and_draft(db_session)
    monkeypatch.setattr(settings, "max_file_size_mb", 1)
    big = fake_store.put(_key(case, "big.pdf"), b"%PDF-" + b"0" * (2 * 1024 * 1024))
    empty = fake_store.put(_key(case, "empty.pdf"), b"")
    body = (await _confirm(client, lawyer, case, [(big, "big.pdf"), (empty, "empty.pdf")])).json()
    assert body["confirmed"] == [] and len(body["rejected"]) == 2
    assert big not in fake_store.objects and empty not in fake_store.objects


async def test_confirm_will_not_file_another_cases_object_or_delete_it(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    other_case = await make_case(db_session, await make_user(db_session, role_name="junior_lawyer"))
    theirs = fake_store.put(_key(other_case, "theirs.pdf"), make_pdf(1))
    sneaky = f"cases/{case.id}/../{other_case.id}/x.pdf"
    fake_store.put(sneaky, make_pdf(1))

    body = (await _confirm(client, lawyer, case, [(theirs, "theirs.pdf"), (sneaky, "x.pdf")])).json()
    assert body["confirmed"] == [] and len(body["rejected"]) == 2
    assert theirs in fake_store.objects, "an object outside this case must never be deleted"
    assert sneaky in fake_store.objects


async def test_confirm_will_not_refile_a_registered_key_as_an_original(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session, status=CaseStatus.SUBMITTED)
    admin = await make_user(db_session, role_name="super_admin")
    draft = await seed_draft(db_session, case, uploader=admin)
    fake_store.put(draft.storage_key, make_pdf(1))

    body = (await _confirm(client, lawyer, case, [(draft.storage_key, "draft_v1.pdf")])).json()
    assert body["confirmed"] == [] and "already been added" in body["rejected"][0]["reason"]
    assert draft.storage_key in fake_store.objects


async def test_confirming_twice_is_harmless(client, db_session, fake_store):
    """The response to the first call can get lost; the retry must not error or
    double-file."""
    lawyer, case = await _lawyer_and_draft(db_session)
    key = fake_store.put(_key(case, "a.pdf"), make_pdf(1))
    first = (await _confirm(client, lawyer, case, [(key, "a.pdf")])).json()
    second = (await _confirm(client, lawyer, case, [(key, "a.pdf")])).json()
    assert second["rejected"] == []
    assert second["confirmed"][0]["id"] == first["confirmed"][0]["id"]
    assert len(await _originals(db_session, case)) == 1


async def test_confirm_stops_at_the_file_count_and_total_size(client, db_session, fake_store, monkeypatch):
    lawyer, case = await _lawyer_and_draft(db_session)
    monkeypatch.setattr(settings, "max_files_per_case", 2)
    keys = [(fake_store.put(_key(case, f"{i}.png"), PNG_BYTES), f"{i}.png") for i in range(3)]
    body = (await _confirm(client, lawyer, case, keys)).json()
    assert len(body["confirmed"]) == 2 and "at most 2 files" in body["rejected"][0]["reason"]
    assert keys[2][0] not in fake_store.objects

    lawyer2, case2 = await _lawyer_and_draft(db_session)
    monkeypatch.setattr(settings, "max_files_per_case", 10)
    monkeypatch.setattr(settings, "max_case_size_mb", 1)
    half = b"\x89PNG\r\n\x1a\n" + b"0" * (600 * 1024)
    k2 = [(fake_store.put(_key(case2, f"{i}.png"), half), f"{i}.png") for i in range(2)]
    body = (await _confirm(client, lawyer2, case2, k2)).json()
    assert len(body["confirmed"]) == 1 and "total at most 1 MB" in body["rejected"][0]["reason"]


async def test_two_confirmations_at_once_cannot_both_slip_under_the_limit(client, db_session, fake_store, monkeypatch):
    lawyer, case = await _lawyer_and_draft(db_session)
    monkeypatch.setattr(settings, "max_files_per_case", 2)
    batch = lambda tag: [(fake_store.put(_key(case, f"{tag}{i}.png"), PNG_BYTES), f"{tag}{i}.png") for i in range(2)]
    a, b = await asyncio.gather(_confirm(client, lawyer, case, batch("a")), _confirm(client, lawyer, case, batch("b")))
    assert a.status_code == b.status_code == 200
    assert len(a.json()["confirmed"]) + len(b.json()["confirmed"]) == 2
    assert len(await _originals(db_session, case)) == 2


async def test_confirm_only_before_review_and_only_by_the_owner(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session, status=CaseStatus.SUBMITTED)
    key = fake_store.put(_key(case, "a.pdf"), make_pdf(1))
    other = await make_user(db_session, role_name="junior_lawyer")
    assert (await _confirm(client, other, case, [(key, "a.pdf")])).status_code == 403
    assert (await _confirm(client, lawyer, case, [(key, "a.pdf")])).status_code == 200
    case.status = CaseStatus.REVIEW_FEE_PAID
    await db_session.commit()
    late = fake_store.put(_key(case, "b.pdf"), make_pdf(1))
    assert (await _confirm(client, lawyer, case, [(late, "b.pdf")])).status_code == 409


async def test_working_on_a_draft_keeps_it_from_looking_abandoned(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    await db_session.execute(text("UPDATE cases SET updated_at = now() - interval '6 days' WHERE id = :i"), {"i": case.id})
    await db_session.commit()
    key = fake_store.put(_key(case, "a.pdf"), make_pdf(1))
    assert (await _confirm(client, lawyer, case, [(key, "a.pdf")])).status_code == 200
    age = (await db_session.execute(text("SELECT now() - updated_at FROM cases WHERE id = :i"), {"i": case.id})).scalar_one()
    assert age.total_seconds() < 60


# --- removing a file ----------------------------------------------------------

async def test_remove_a_file_from_a_draft_deletes_the_object(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session)
    doc = await seed_original(db_session, case, uploader=lawyer)
    fake_store.put(doc.storage_key, make_pdf(1))
    resp = await client.delete(f"/documents/{doc.id}", headers=auth_header(lawyer))
    assert resp.status_code == 204
    assert doc.storage_key not in fake_store.objects
    assert await _originals(db_session, case) == []


async def test_a_submitted_case_keeps_at_least_one_file(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session, status=CaseStatus.SUBMITTED)
    first = await seed_original(db_session, case, uploader=lawyer, name="a.pdf")
    second = await seed_original(db_session, case, uploader=lawyer, name="b.pdf")
    h = auth_header(lawyer)
    assert (await client.delete(f"/documents/{first.id}", headers=h)).status_code == 204
    last = await client.delete(f"/documents/{second.id}", headers=h)
    assert last.status_code == 409 and "at least one file" in last.json()["detail"]
    assert len(await _originals(db_session, case)) == 1


async def test_remove_is_refused_after_review_for_drafts_and_for_strangers(client, db_session, fake_store):
    lawyer, case = await _lawyer_and_draft(db_session, status=CaseStatus.ACCEPTED)
    admin = await make_user(db_session, role_name="super_admin")
    original = await seed_original(db_session, case, uploader=lawyer)
    draft = await seed_draft(db_session, case, uploader=admin)
    h = auth_header(lawyer)
    assert (await client.delete(f"/documents/{original.id}", headers=h)).status_code == 409
    case.status = CaseStatus.SUBMITTED
    await db_session.commit()
    assert (await client.delete(f"/documents/{draft.id}", headers=h)).status_code == 409
    other = await make_user(db_session, role_name="junior_lawyer")
    assert (await client.delete(f"/documents/{original.id}", headers=auth_header(other))).status_code == 403
    assert (await client.delete(f"/documents/{original.id}", headers=auth_header(admin))).status_code == 403
    assert (await client.delete(f"/documents/{uuid.uuid4()}", headers=h)).status_code == 404


# --- config -------------------------------------------------------------------

async def test_pricing_and_upload_rules_come_from_the_server(client, db_session):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    h = auth_header(lawyer)
    pricing = (await client.get("/config/pricing", headers=h)).json()
    assert pricing == {"review_fee_inr": settings.review_fee_inr,
                       "quote_min_inr": settings.quote_min_inr, "quote_max_inr": settings.quote_max_inr}
    rules = (await client.get("/config/uploads", headers=h)).json()
    assert rules["max_files"] == settings.max_files_per_case
    assert rules["accepted"][".docx"] == DOCX and set(rules["accepted"]) == {
        ".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg"}
    assert (await client.get("/config/pricing")).status_code in (401, 403)
