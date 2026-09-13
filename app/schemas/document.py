import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.document import DocumentType


class UploadUrlRequest(BaseModel):
    case_id: uuid.UUID
    filename: str
    document_type: DocumentType


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
    uploaded_by: uuid.UUID
    created_at: datetime


class ConfirmUploadRequest(BaseModel):
    case_id: uuid.UUID
    storage_key: str
    original_filename: str
    document_type: DocumentType
