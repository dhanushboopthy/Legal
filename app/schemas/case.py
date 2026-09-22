import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.case import CaseStatus
from app.models.revision import RevisionStatus
from app.schemas.message import LastMessageOut, Turn


class CaseCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    case_type: str = Field(min_length=2, max_length=100)
    court: str | None = None
    description: str | None = None
    note: str | None = Field(default=None, max_length=2000)


class CaseUpdate(BaseModel):
    """Edits to a draft case before it is submitted; only what is sent changes."""

    title: str | None = Field(default=None, min_length=3, max_length=255)
    case_type: str | None = Field(default=None, min_length=2, max_length=100)
    court: str | None = Field(default=None, max_length=150)
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
    case_number: str | None
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


class CaseListItem(CaseOut):
    """A case in the list, with what the list needs to say about its chat."""

    last_message: LastMessageOut | None = None
    unread_count: int = 0
    turn: Turn = "none"
    # For the advocate's grouped list (lawyer name, Bar Council ID); not shown
    # to the lawyer looking at their own cases.
    junior_lawyer_name: str = ""
    junior_lawyer_bar_council_id: str | None = None
