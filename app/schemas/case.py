import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.case import CaseStatus
from app.models.revision import RevisionStatus


class CaseCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    case_type: str = Field(min_length=2, max_length=100)
    court: str | None = None
    description: str | None = None
    note: str | None = Field(default=None, max_length=2000)


class CaseDecision(BaseModel):
    accept: bool
    rejection_reason: str | None = None


class RevisionCreate(BaseModel):
    reason: str = Field(min_length=5, max_length=2000)


class CaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    junior_lawyer_id: uuid.UUID
    title: str
    case_type: str
    court: str | None
    description: str | None
    note: str | None
    status: CaseStatus
    rejection_reason: str | None
    revision_count: int
    created_at: datetime
    updated_at: datetime


class RevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reason: str
    status: RevisionStatus
    created_at: datetime
