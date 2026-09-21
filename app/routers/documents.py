import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import ForbiddenError, NotFoundError, ValidationAppError
from app.core.permissions import CASE_DRAFT
from app.database import get_db
from app.dependencies import get_current_user
from app.models.case import CaseStatus
from app.models.document import CaseDocument, DocumentType
from app.models.user import User
from app.schemas.document import ConfirmUploadRequest, DocumentOut, UploadUrlRequest, UploadUrlResponse
from app.services import audit_service, case_service, storage_service

router = APIRouter(prefix="/documents", tags=["documents"])

# A draft is filed with its price (POST /cases/{id}/quote) or as a new version
# (POST /cases/{id}/drafts), which verify it; only the junior's original goes
# through the plain confirm below.
_UPLOADABLE_TYPES = {DocumentType.ORIGINAL, DocumentType.DRAFT}
_ORIGINAL_ACCEPTED_IN = {CaseStatus.DRAFT, CaseStatus.SUBMITTED}


@router.post("/upload-url", response_model=UploadUrlResponse)
async def get_upload_url(
    payload: UploadUrlRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.document_type not in _UPLOADABLE_TYPES:
        raise ValidationAppError("Only the original case file or a draft can be uploaded here")

    case = await case_service.get_case_or_404(db, payload.case_id)

    # Only the owning junior lawyer may upload the original case file;
    # only the advocate (someone holding CASE_DRAFT) may upload a draft.
    if payload.document_type == DocumentType.ORIGINAL:
        case_service.require_owner(case, current_user)
    elif CASE_DRAFT not in (current_user.role.permissions or []):
        raise ForbiddenError("Only the reviewing advocate may upload a draft")

    storage_key = storage_service.build_storage_key(case.id, payload.filename)
    url = storage_service.generate_presigned_upload_url(storage_key)
    return UploadUrlResponse(
        upload_url=url, storage_key=storage_key,
        expires_in_seconds=settings.s3_presigned_url_expire_seconds,
    )


@router.post("/confirm", response_model=DocumentOut)
async def confirm_upload(
    payload: ConfirmUploadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Client calls this after a successful direct-to-store PUT so the DB has a
    record of the original case file."""
    if payload.document_type != DocumentType.ORIGINAL:
        raise ValidationAppError(
            "Drafts are sent with their price: POST /cases/{id}/quote, or "
            "POST /cases/{id}/drafts for a new version"
        )

    case = await case_service.get_case_or_404(db, payload.case_id)
    case_service.require_owner(case, current_user)
    if case.status not in _ORIGINAL_ACCEPTED_IN:
        raise ValidationAppError(
            "Files can only be added to a case before it is reviewed; "
            "after that, share them in the case chat"
        )

    doc = CaseDocument(
        case_id=case.id, type=DocumentType.ORIGINAL, version=1,
        storage_key=payload.storage_key, original_filename=payload.original_filename,
        uploaded_by=current_user.id,
    )
    db.add(doc)
    await audit_service.log_action(
        db, user_id=current_user.id, action="document.uploaded",
        entity_type="case_document", entity_id=str(case.id),
    )
    await db.commit()
    await db.refresh(doc)
    return DocumentOut.of(doc)


@router.get("/case/{case_id}", response_model=list[DocumentOut])
async def list_case_documents(
    case_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, case_id)
    case_service.authorize_case_access(case, current_user)
    drafts_open = case_service.can_open_drafts(case, current_user)
    return [
        DocumentOut.of(doc, locked=doc.type == DocumentType.DRAFT and not drafts_open)
        for doc in case.documents
    ]


@router.get("/{document_id}/download-url")
async def get_download_url(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(CaseDocument).where(CaseDocument.id == document_id))
    document = result.scalar_one_or_none()
    if document is None:
        raise NotFoundError("Document not found")

    case = await case_service.get_case_or_404(db, document.case_id)
    case_service.authorize_case_access(case, current_user)

    # Enforced here, not only in the UI: an unpaid draft has no download link.
    if document.type == DocumentType.DRAFT and not case_service.can_open_drafts(case, current_user):
        raise ForbiddenError("payment_required")

    url = storage_service.generate_presigned_download_url(document.storage_key)
    return {"download_url": url, "expires_in_seconds": settings.s3_presigned_url_expire_seconds}
