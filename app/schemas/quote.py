import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.quote import QuoteStatus


class DraftUpload(BaseModel):
    """A draft PDF the advocate has already PUT to the store."""
    storage_key: str = Field(min_length=1, max_length=500)
    original_filename: str = Field(min_length=1, max_length=255)


class QuoteCreate(BaseModel):
    draft: DraftUpload
    # Whole rupees. The range is checked against QUOTE_MIN_INR / QUOTE_MAX_INR
    # in the service so the message can name the limits.
    amount_inr: int
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def _blank_note_is_none(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        return value or None


class QuoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_id: uuid.UUID
    version: int
    amount_inr: int
    amount_paise: int
    currency: str
    note: str | None
    status: QuoteStatus
    draft_document_id: uuid.UUID
    created_at: datetime
    paid_at: datetime | None
