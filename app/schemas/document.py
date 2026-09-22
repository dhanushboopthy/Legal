import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.document import DocumentType


class UploadUrlRequest(BaseModel):
    """For the advocate's draft PDF; the lawyer's files use UploadUrlsRequest."""

    case_id: uuid.UUID
    filename: str


class UploadUrlResponse(BaseModel):
    upload_url: str
    storage_key: str
    expires_in_seconds: int


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_id: uuid.UUID
    type: DocumentType
    version: int
    original_filename: str
    size_bytes: int | None = None
    content_type: str | None = None
    page_count: int | None = None
    uploaded_by: uuid.UUID
    created_at: datetime
    # True for a draft the viewer can see but not yet open (unpaid quote). The
    # storage key is never part of this response either way; a locked draft
    # is refused by the download endpoint too.
    locked: bool = False

    @classmethod
    def of(cls, document, *, locked: bool = False) -> "DocumentOut":
        out = cls.model_validate(document)
        out.locked = locked
        return out
