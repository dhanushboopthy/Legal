import asyncio
from io import BytesIO

from pypdf import PdfReader
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import uploads
from app.core.exceptions import ConflictError, ValidationAppError
from app.models.case import Case, CaseStatus
from app.models.document import CaseDocument, DocumentType
from app.models.user import User
from app.schemas.upload import ConfirmFileSpec, RejectedFile, UploadFileSpec, UploadTarget
from app.services import storage_service

PDF_CONTENT_TYPE = "application/pdf"


def _count_pages(data: bytes) -> int:
    reader = PdfReader(BytesIO(data), strict=False)
    if reader.is_encrypted:
        raise ValueError("password-protected")
    return len(reader.pages)


async def register_draft(
    db: AsyncSession, *, case: Case, uploader: User, storage_key: str, filename: str,
) -> CaseDocument:
    """File an uploaded draft as the case's next draft version, after checking
    the object really is a PDF. The client only ever names a `storage_key`; it
    can't claim a page count or a size — those are read back from the store.

    Does not change case status; callers own the transition. A file that fails
    the checks is deleted from the store — except a key that is already a
    registered document, which is refused untouched."""
    if not storage_key.startswith(f"cases/{case.id}/") or ".." in storage_key:
        raise ValidationAppError("That file doesn't belong to this case")
    if not filename.lower().endswith(".pdf"):
        raise ValidationAppError("The draft must be a PDF file")

    already = await db.execute(select(CaseDocument.id).where(CaseDocument.storage_key == storage_key))
    if already.first() is not None:
        raise ValidationAppError("That file has already been added to this case")

    info = await storage_service.head_object(storage_key)
    if info is None:
        raise ValidationAppError("We couldn't find the uploaded file. Upload it again and retry.")

    limit = settings.max_file_size_mb * 1024 * 1024
    if info.size > limit:
        await storage_service.delete_object(storage_key)
        raise ValidationAppError(f"The draft can be at most {settings.max_file_size_mb} MB")

    data = await storage_service.read_object(storage_key)
    if not data.startswith(b"%PDF-"):
        await storage_service.delete_object(storage_key)
        raise ValidationAppError("That file isn't a PDF")
    try:
        pages = await asyncio.to_thread(_count_pages, data)
    except Exception:
        await storage_service.delete_object(storage_key)
        raise ValidationAppError(
            "We couldn't read that PDF. Check it isn't corrupted or password-protected."
        ) from None

    latest = await db.execute(
        select(func.max(CaseDocument.version)).where(
            CaseDocument.case_id == case.id, CaseDocument.type == DocumentType.DRAFT
        )
    )
    doc = CaseDocument(
        case_id=case.id, type=DocumentType.DRAFT, version=(latest.scalar() or 0) + 1,
        storage_key=storage_key, original_filename=filename, uploaded_by=uploader.id,
        size_bytes=info.size, content_type=PDF_CONTENT_TYPE, page_count=pages,
    )
    db.add(doc)
    await db.flush()
    return doc


# --- the junior's case files (docs/NEW_FLOW_SPEC.md §6) -----------------

# Files can be added or removed only until the advocate starts reviewing.
FILES_EDITABLE_IN = {CaseStatus.DRAFT, CaseStatus.SUBMITTED}


def _mb(n: int) -> int:
    return n * 1024 * 1024


def assert_files_editable(case: Case) -> None:
    if case.status not in FILES_EDITABLE_IN:
        raise ConflictError(
            "Files can only be changed before the case is reviewed; "
            "after that, share them in the case chat"
        )


async def _documents_of(db: AsyncSession, case_id, doc_type: DocumentType) -> list[CaseDocument]:
    # Read fresh from the database: callers hold the case row lock, and the
    # case's own `documents` collection may have been loaded before it.
    result = await db.execute(
        select(CaseDocument).where(
            CaseDocument.case_id == case_id, CaseDocument.type == doc_type
        ).order_by(CaseDocument.created_at)
    )
    return list(result.scalars().all())


async def _originals(db: AsyncSession, case_id) -> list[CaseDocument]:
    return await _documents_of(db, case_id, DocumentType.ORIGINAL)


def _check_spec(spec: UploadFileSpec) -> None:
    name = spec.filename
    if not uploads.is_clean_filename(name):
        raise ValidationAppError("A file has an invalid name")
    kind = uploads.kind_for(name)
    if kind is None:
        raise ValidationAppError(
            f"'{name}' isn't an accepted file type. Use PDF, DOC, DOCX, PNG or JPG."
        )
    if spec.content_type != kind.content_type:
        raise ValidationAppError(f"'{name}' doesn't look like a {uploads.extension_of(name)} file")
    if spec.size > _mb(settings.max_file_size_mb):
        raise ValidationAppError(f"'{name}' is larger than {settings.max_file_size_mb} MB")


async def create_upload_targets(
    db: AsyncSession, *, case: Case, specs: list[UploadFileSpec],
) -> list[UploadTarget]:
    """Validate the files a lawyer wants to add and sign one upload URL each.
    The validated type and size are signed into the URL, so the store itself
    refuses anything else."""
    assert_files_editable(case)
    for spec in specs:
        _check_spec(spec)

    existing = await _originals(db, case.id)
    if len(existing) + len(specs) > settings.max_files_per_case:
        raise ValidationAppError(f"A case can have at most {settings.max_files_per_case} files")
    total = sum(d.size_bytes or 0 for d in existing) + sum(s.size for s in specs)
    if total > _mb(settings.max_case_size_mb):
        raise ValidationAppError(f"A case's files can total at most {settings.max_case_size_mb} MB")

    return _sign(case, specs)


def _sign(case: Case, specs: list[UploadFileSpec]) -> list[UploadTarget]:
    targets = []
    for spec in specs:
        key = storage_service.build_storage_key(case.id, spec.filename)
        targets.append(UploadTarget(
            filename=spec.filename, content_type=spec.content_type, size=spec.size,
            storage_key=key,
            upload_url=storage_service.generate_presigned_upload_url(
                key, content_type=spec.content_type, size=spec.size
            ),
            expires_in_seconds=settings.s3_presigned_url_expire_seconds,
        ))
    return targets


async def _reject(spec: ConfirmFileSpec, reason: str, *, delete: bool) -> RejectedFile:
    if delete:
        await storage_service.delete_object(spec.storage_key)
    return RejectedFile(
        storage_key=spec.storage_key, original_filename=spec.original_filename, reason=reason,
    )


async def _register_files(
    db: AsyncSession, *, case: Case, uploader: User, files: list[ConfirmFileSpec],
    doc_type: DocumentType, existing: list[CaseDocument], max_files: int | None,
) -> tuple[list[CaseDocument], list[RejectedFile]]:
    """The one place an uploaded object becomes a document. Every object is
    checked (belongs to this case, exists, within limits, first bytes match the
    claimed type); one that fails is rejected and deleted without affecting the
    rest. A key already filed as this type on this case is a no-op that returns
    the existing document, so a retry after a dropped response is safe.

    The caller holds the case row lock, which is what keeps two callers from
    both passing the count and size limits."""
    by_key = {d.storage_key: d for d in existing}
    count = len(existing)
    total = sum(d.size_bytes or 0 for d in existing)

    confirmed: list[CaseDocument] = []
    rejected: list[RejectedFile] = []
    for spec in files:
        key = spec.storage_key
        if key in by_key:
            confirmed.append(by_key[key])
            continue
        if not key.startswith(f"cases/{case.id}/") or ".." in key:
            rejected.append(await _reject(spec, "That file doesn't belong to this case", delete=False))
            continue
        taken = await db.execute(select(CaseDocument.id).where(CaseDocument.storage_key == key))
        if taken.first() is not None:
            rejected.append(await _reject(spec, "That file has already been added", delete=False))
            continue
        name = spec.original_filename
        kind = uploads.kind_for(name)
        if not uploads.is_clean_filename(name) or kind is None:
            rejected.append(await _reject(
                spec, "Only PDF, DOC, DOCX, PNG and JPG files are accepted", delete=True))
            continue
        info = await storage_service.head_object(key)
        if info is None:
            rejected.append(await _reject(
                spec, "We couldn't find the uploaded file. Upload it again.", delete=False))
            continue
        if info.size == 0:
            rejected.append(await _reject(spec, "That file is empty", delete=True))
            continue
        if info.size > _mb(settings.max_file_size_mb):
            rejected.append(await _reject(
                spec, f"Files can be at most {settings.max_file_size_mb} MB", delete=True))
            continue
        if max_files is not None and count + 1 > max_files:
            rejected.append(await _reject(
                spec, f"A case can have at most {max_files} files", delete=True))
            continue
        if total + info.size > _mb(settings.max_case_size_mb):
            rejected.append(await _reject(
                spec, f"A case's files can total at most {settings.max_case_size_mb} MB", delete=True))
            continue
        head = await storage_service.read_head(key, uploads.MAGIC_READ_BYTES)
        if not uploads.matches_magic(name, head):
            rejected.append(await _reject(
                spec, f"That doesn't look like a real {uploads.extension_of(name)} file", delete=True))
            continue

        doc = CaseDocument(
            case_id=case.id, type=doc_type, version=1,
            storage_key=key, original_filename=name, uploaded_by=uploader.id,
            size_bytes=info.size, content_type=kind.content_type,
        )
        db.add(doc)
        by_key[key] = doc
        confirmed.append(doc)
        count += 1
        total += info.size
    await db.flush()
    return confirmed, rejected


async def register_originals(
    db: AsyncSession, *, case: Case, uploader: User, files: list[ConfirmFileSpec],
) -> tuple[list[CaseDocument], list[RejectedFile]]:
    """File the lawyer's submitted files. Only before the case is reviewed."""
    assert_files_editable(case)
    return await _register_files(
        db, case=case, uploader=uploader, files=files, doc_type=DocumentType.ORIGINAL,
        existing=await _originals(db, case.id), max_files=settings.max_files_per_case,
    )


async def remove_original(db: AsyncSession, *, case: Case, document: CaseDocument) -> None:
    """Take a file off a case that hasn't been reviewed yet. A submitted case
    keeps at least one file, so it can't be left with nothing to review."""
    assert_files_editable(case)
    if document.type != DocumentType.ORIGINAL or document.case_id != case.id:
        raise ConflictError("Only the files you submitted with the case can be removed")
    if case.status == CaseStatus.SUBMITTED:
        remaining = [d for d in await _originals(db, case.id) if d.id != document.id]
        if not remaining:
            raise ConflictError("A submitted case needs at least one file")
    # Object first: if the store refuses, nothing has changed and the lawyer can
    # retry. Deleting a missing object is not an error.
    await storage_service.delete_object(document.storage_key)
    await db.delete(document)
    await db.flush()


async def count_originals(db: AsyncSession, case_id) -> int:
    return len(await _originals(db, case_id))
