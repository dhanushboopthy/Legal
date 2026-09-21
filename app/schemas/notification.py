import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    message: str
    case_id: uuid.UUID | None = None
    kind: str | None = None
    is_read: bool
    created_at: datetime
