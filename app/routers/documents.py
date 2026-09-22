import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import ForbiddenError, NotFoundError, ValidationAppError
from app.core.permissions import CASE_DRAFT, CASE_SUBMIT
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.document import CaseDocument, DocumentType
from app.models.user import User
from app.schemas.document import DocumentOut, UploadUrlRequest, UploadUrlResponse
from app.schemas.upload import ConfirmBatchRequest, ConfirmBatchResponse, UploadUrlsRequest, UploadUrlsResponse
from app.services import audit_service, case_service, document_service, storage_service

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post(
    "/upload-urls", response_model=UploadUrlsResponse,
    dependencies=[Depends(require_permission(CASE_SUBMIT))],
)
@limiter.limit("30/minute")
async def get_upload_urls(
    request: Request,
    payload: UploadUrlsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """One presigned PUT per file the lawyer wants to add to their case. Type,
    size and count limits are checked here, before anything is uploaded."""
    case = await case_service.get_case_or_404(db, payload.case_id)
    case_service.require_owner(case, current_user)
    targets = await document_service.create_upload_targets(db, case=case, specs=payload.files)
    return UploadUrlsResponse(files=targets)


@router.post(
    "/confirm-batch", response_model=ConfirmBatchResponse,
    dependencies=[Depends(require_permission(CASE_SUBMIT))],
)
@limiter.limit("30/minute")
async def confirm_batch(
    request: Request,
    payload: ConfirmBatchRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Called after the browser has PUT the files. Each object is verified
    (exists, within limits, first bytes match its type) and filed; a file that
    fails is reported and deleted, and the rest still go through."""
    case = await case_service.get_case_or_404(db, payload.case_id)
    case_service.require_owner(case, current_user)
    # Serialise confirmations so two at once can't both pass the file limits.
    case = await case_service.lock_case(db, case.id)
    confirmed, rejected = await document_service.register_originals(
        db, case=case, uploader=current_user, files=payload.files,
    )
    if confirmed:
        case_service.touch(case)
        await audit_service.log_action(
            db, user_id=current_user.id, action="document.uploaded",
            entity_type="case", entity_id=str(case.id), metadata={"count": len(confirmed)},
        )
    await db.commit()
    for doc in confirmed:
        await db.refresh(doc)  # server-side defaults (created_at) aren't loaded yet
    return ConfirmBatchResponse(
        confirmed=[DocumentOut.of(doc) for doc in confirmed], rejected=rejected,
    )


@router.post("/upload-url", response_model=UploadUrlResponse)
async def get_draft_upload_url(
    payload: UploadUrlRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Presigned PUT for the advocate's draft PDF. The draft is filed with its
    price (POST /cases/{id}/quote) or as a new version (POST /cases/{id}/drafts),
    which verify it; the lawyer's own files go through upload-urls above."""
    case = await case_service.get_case_or_404(db, payload.case_id)
    case_service.authorize_case_access(case, current_user)
    if CASE_DRAFT not in (current_user.role.permissions or []):
        raise ForbiddenError("Only the reviewing advocate may upload a draft")
    if not payload.filename.lower().endswith(".pdf"):
        raise ValidationAppError("The draft must be a PDF file")

    storage_key = storage_service.build_storage_key(case.id, payload.filename)
    url = storage_service.generate_presigned_upload_url(
        storage_key, content_type="application/pdf"
    )
    return UploadUrlResponse(
        upload_url=url, storage_key=storage_key,
        expires_in_seconds=settings.s3_presigned_url_expire_seconds,
    )


@router.delete(
    "/{document_id}", status_code=204,
    dependencies=[Depends(require_permission(CASE_SUBMIT))],
)
async def remove_document(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove one of the lawyer's own files, before the case is reviewed."""
    document = (await db.execute(
        select(CaseDocument).where(CaseDocument.id == document_id)
    )).scalar_one_or_none()
    if document is None:
        raise NotFoundError("Document not found")
    case = await case_service.get_case_or_404(db, document.case_id)
    case_service.require_owner(case, current_user)
    case = await case_service.lock_case(db, case.id)
    await document_service.remove_original(db, case=case, document=document)
    case_service.touch(case)
    await audit_service.log_action(
        db, user_id=current_user.id, action="document.removed",
        entity_type="case", entity_id=str(case.id),
    )
    await db.commit()
    return Response(status_code=204)


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
