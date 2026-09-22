import uuid

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import get_current_user
from app.models.case import Case
from app.models.user import User
from app.schemas.message import (
    AttachmentUploadRequest, MessageCreate, MessageOut, MessagePage, ReadRequest,
)
from app.schemas.upload import UploadUrlsResponse
from app.services import case_service, document_service, message_service

router = APIRouter(prefix="/cases", tags=["chat"])


async def _case_for_chat(db: AsyncSession, case_id: uuid.UUID, user: User) -> Case:
    case = await case_service.get_case_or_404(db, case_id)
    # Same visibility rules as the case itself first (a draft is a 404 to anyone
    # but its owner), then the narrower one: who is actually in the chat.
    case_service.authorize_case_access(case, user)
    message_service.require_participant(case, user)
    return case


@router.get("/{case_id}/messages", response_model=MessagePage)
async def list_messages(
    case_id: uuid.UUID,
    before: int | None = Query(default=None, ge=1),
    after: int | None = Query(default=None, ge=0),
    limit: int = Query(default=30, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Newest messages by default; `before` pages back through history; `after`
    is what a poll asks: everything newer than the last message it has."""
    case = await _case_for_chat(db, case_id, current_user)
    return await message_service.list_page(
        db, case=case, viewer=current_user, before=before, after=after, limit=limit,
    )


@router.post("/{case_id}/messages", response_model=MessageOut, status_code=201)
@limiter.limit("30/minute")
async def send_message(
    request: Request,
    response: Response,
    case_id: uuid.UUID,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send text and/or files. Sending the same `client_id` again returns the
    message already posted (200) instead of posting another (201)."""
    case = await _case_for_chat(db, case_id, current_user)
    message, created = await message_service.send(
        db, case=case, sender=current_user, body=payload.body,
        attachments=payload.attachments, client_id=payload.client_id,
    )
    await db.commit()
    if not created:
        response.status_code = 200
    return (await message_service.serialize(db, [message]))[0]


@router.post("/{case_id}/read")
async def mark_read(
    case_id: uuid.UUID,
    payload: ReadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    case = await _case_for_chat(db, case_id, current_user)
    position = await message_service.mark_read(
        db, case=case, user=current_user, last_read_message_id=payload.last_read_message_id,
    )
    await db.commit()
    return {"last_read_message_id": position}


@router.post("/{case_id}/attachments/upload-urls", response_model=UploadUrlsResponse)
@limiter.limit("30/minute")
async def attachment_upload_urls(
    request: Request,
    case_id: uuid.UUID,
    payload: AttachmentUploadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Signed uploads for the files of a message about to be sent (up to 5)."""
    case = await _case_for_chat(db, case_id, current_user)
    message_service.assert_open(case)
    targets = await document_service.create_attachment_targets(db, case=case, specs=payload.files)
    return UploadUrlsResponse(files=targets)
