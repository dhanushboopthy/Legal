import uuid

from pydantic import BaseModel, Field

from app.schemas.document import DocumentOut


class UploadFileSpec(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(max_length=100)
    size: int = Field(gt=0)


class UploadUrlsRequest(BaseModel):
    case_id: uuid.UUID
    files: list[UploadFileSpec] = Field(min_length=1, max_length=50)


class UploadTarget(BaseModel):
    filename: str
    content_type: str
    size: int
    storage_key: str
    upload_url: str
    expires_in_seconds: int


class UploadUrlsResponse(BaseModel):
    files: list[UploadTarget]


class ConfirmFileSpec(BaseModel):
    storage_key: str = Field(min_length=1, max_length=500)
    original_filename: str = Field(min_length=1, max_length=255)


class ConfirmBatchRequest(BaseModel):
    case_id: uuid.UUID
    files: list[ConfirmFileSpec] = Field(min_length=1, max_length=50)


class RejectedFile(BaseModel):
    storage_key: str
    original_filename: str
    reason: str


class ConfirmBatchResponse(BaseModel):
    """Each file stands or falls alone, so a retry only redoes what failed."""

    confirmed: list[DocumentOut]
    rejected: list[RejectedFile]


class UploadRulesOut(BaseModel):
    max_files: int
    max_file_size_mb: int
    max_case_size_mb: int
    # extension -> content type, e.g. {".pdf": "application/pdf"}
    accepted: dict[str, str]


class PricingOut(BaseModel):
    review_fee_inr: int
    quote_min_inr: int
    quote_max_inr: int
