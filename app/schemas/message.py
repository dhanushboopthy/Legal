import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.upload import ConfirmFileSpec, UploadFileSpec


class AttachmentOut(BaseModel):
    document_id: uuid.UUID
    filename: str
    size_bytes: int | None
    content_type: str | None


class MessageOut(BaseModel):
    id: int
    case_id: uuid.UUID
    sender_id: uuid.UUID | None
    sender_name: str | None
    kind: str
    body: str | None
    meta: dict
    attachments: list[AttachmentOut]
    client_id: uuid.UUID | None
    created_at: datetime


class MessagePage(BaseModel):
    """`messages` are oldest-first. `has_more` says older ones exist. The two
    cursors let the client draw the unread divider and the "Seen" mark."""

    messages: list[MessageOut]
    has_more: bool
    my_last_read_id: int
    other_last_read_id: int
    # False once the case is complete: the thread stays readable but can't be added to.
    open: bool


class MessageCreate(BaseModel):
    client_id: uuid.UUID
    body: str | None = Field(default=None, max_length=4000)
    # Files already PUT to storage; verified and filed together with the message.
    attachments: list[ConfirmFileSpec] = Field(default_factory=list, max_length=5)


class AttachmentUploadRequest(BaseModel):
    files: list[UploadFileSpec] = Field(min_length=1, max_length=5)


class ReadRequest(BaseModel):
    last_read_message_id: int = Field(ge=0)


class LastMessageOut(BaseModel):
    preview: str
    at: datetime
    sender_name: str | None
    kind: str


class TicketOut(BaseModel):
    ticket: str
    expires_in_seconds: int


Turn = Literal["you", "them", "none"]
