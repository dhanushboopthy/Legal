import asyncio
from io import BytesIO

from pypdf import PdfReader
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import ValidationAppError
from app.models.case import Case
from app.models.document import CaseDocument, DocumentType
from app.models.user import User
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


