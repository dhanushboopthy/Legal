"""The worker's sweep of draft cases nobody came back to."""
import uuid

from sqlalchemy import select, text

from app import worker
from app.models.case import Case, CaseStatus
from app.models.document import CaseDocument
from app.services import maintenance_service, storage_service
from tests.conftest import AsyncSessionLocal, make_case, make_pdf, make_user
from tests.helpers import seed_original


# The purge commits and rolls back on the session it is given, which expires
# every object the test holds; so the tests keep plain ids and read back
# through a fresh session.
async def _age(db, case, days):
    await db.execute(text("UPDATE cases SET updated_at = now() - make_interval(days => :d) WHERE id = :i"),
                     {"d": days, "i": case.id})
    await db.commit()


async def _exists(_db, case_id):
    async with AsyncSessionLocal() as fresh:
        return (await fresh.execute(select(Case.id).where(Case.id == case_id))).first() is not None


async def _stale_draft_with_files(db, store, *, days=8):
    lawyer = await make_user(db, role_name="junior_lawyer")
    case = await make_case(db, lawyer, status=CaseStatus.DRAFT)
    doc = await seed_original(db, case, uploader=lawyer)
    store.put(doc.storage_key, make_pdf(1))
    orphan = store.put(f"cases/{case.id}/{uuid.uuid4()}_unconfirmed.png", b"\x89PNG\r\n\x1a\n")
    await _age(db, case, days)
    return case.id, doc.storage_key, orphan


async def test_a_stale_draft_and_all_its_files_are_deleted(db_session, fake_store):
    case_id, doc_key, orphan = await _stale_draft_with_files(db_session, fake_store)
    kept_key = fake_store.put(f"cases/{uuid.uuid4()}/other.pdf", make_pdf(1))

    assert await maintenance_service.purge_stale_drafts(db_session) == 1
    assert not await _exists(db_session, case_id)
    assert doc_key not in fake_store.objects and orphan not in fake_store.objects
    assert kept_key in fake_store.objects
    async with AsyncSessionLocal() as fresh:
        assert (await fresh.execute(select(CaseDocument.id).where(CaseDocument.case_id == case_id))).first() is None


async def test_only_stale_drafts_are_purged(db_session, fake_store):
    lawyer = await make_user(db_session, role_name="junior_lawyer")
    fresh = await make_case(db_session, lawyer, status=CaseStatus.DRAFT)
    six_days = await make_case(db_session, lawyer, status=CaseStatus.DRAFT)
    old_submitted = await make_case(db_session, lawyer, status=CaseStatus.SUBMITTED)
    old_paid = await make_case(db_session, lawyer, status=CaseStatus.REVIEW_FEE_PAID)
    await _age(db_session, six_days, 6)
    await _age(db_session, old_submitted, 30)
    await _age(db_session, old_paid, 30)
    ids = [c.id for c in (fresh, six_days, old_submitted, old_paid)]

    assert await maintenance_service.purge_stale_drafts(db_session) == 0
    for case_id in ids:
        assert await _exists(db_session, case_id)


async def test_the_sweep_is_idempotent(db_session, fake_store):
    await _stale_draft_with_files(db_session, fake_store)
    assert await maintenance_service.purge_stale_drafts(db_session) == 1
    assert await maintenance_service.purge_stale_drafts(db_session) == 0


async def test_a_storage_failure_keeps_the_case_for_the_next_sweep(db_session, fake_store, monkeypatch):
    broken, _, _ = await _stale_draft_with_files(db_session, fake_store)
    fine, _, _ = await _stale_draft_with_files(db_session, fake_store)
    real = storage_service.delete_prefix

    async def flaky(prefix):
        if str(broken) in prefix:
            raise RuntimeError("store unavailable")
        return await real(prefix)

    monkeypatch.setattr(storage_service, "delete_prefix", flaky)
    assert await maintenance_service.purge_stale_drafts(db_session) == 1
    assert await _exists(db_session, broken) and not await _exists(db_session, fine)

    monkeypatch.setattr(storage_service, "delete_prefix", real)
    assert await maintenance_service.purge_stale_drafts(db_session) == 1
    assert not await _exists(db_session, broken)


async def test_a_draft_being_submitted_right_now_is_left_alone(db_session, fake_store):
    case_id, doc_key, _ = await _stale_draft_with_files(db_session, fake_store)
    async with AsyncSessionLocal() as other:
        # Another request holds the row (submit, or a file confirmation).
        await other.execute(select(Case).where(Case.id == case_id).with_for_update())
        assert await maintenance_service.purge_stale_drafts(db_session) == 0
        await other.rollback()
    assert await _exists(db_session, case_id) and doc_key in fake_store.objects


async def test_the_worker_sweep_runs_the_purge(db_session, fake_store):
    case_id, _, _ = await _stale_draft_with_files(db_session, fake_store)
    await worker.run_once()
    assert not await _exists(db_session, case_id)
