import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, NotFoundError
from app.core.permissions import CASE_DRAFT
from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.document import CaseDocument, DocumentType
from app.models.user import User
from app.schemas.document import ConfirmUploadRequest, DocumentOut, UploadUrlRequest, UploadUrlResponse
from app.services import audit_service, case_service, storage_service
from app.config import settings

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/upload-url", response_model=UploadUrlResponse)
async def get_upload_url(
    payload: UploadUrlRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await case_service.get_case_or_404(db, payload.case_id)

    # Only the owning junior lawyer may upload the original case file;
    # only the admin (someone holding CASE_DRAFT) may upload a draft/final filing.
    if payload.document_type == DocumentType.ORIGINAL:
        case_service.authorize_case_access(case, current_user)
    elif CASE_DRAFT not in (current_user.role.permissions or []):
        raise ForbiddenError("Only the reviewing advocate may upload draft or final filings")

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
    """
    Client calls this after a successful direct-to-S3 PUT so the DB has a
    record of the file. For ORIGINAL uploads this just files the document;
    for DRAFT uploads it also advances the case status via case_service.
    """
    case = await case_service.get_case_or_404(db, payload.case_id)

    if payload.document_type == DocumentType.ORIGINAL:
        case_service.authorize_case_access(case, current_user)
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
    else:
        doc = await case_service.deliver_draft(
            db, case=case, admin=current_user,
            storage_key=payload.storage_key, filename=payload.original_filename,
        )

    await db.commit()
    await db.refresh(doc)
    return doc


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

    url = storage_service.generate_presigned_download_url(document.storage_key)
    return {"download_url": url, "expires_in_seconds": settings.s3_presigned_url_expire_seconds}
