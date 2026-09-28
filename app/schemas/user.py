import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.services import avatar_service


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: EmailStr
    phone: str | None
    bar_council_id: str | None
    # Presigned, short-lived; None when there is no profile picture.
    avatar_url: str | None = None
    role_name: str
    # The role's current permission names, so the UI can gate by capability
    # ("can submit a case") instead of hard-coding role names.
    permissions: list[str]
    is_active: bool
    is_verified: bool
    # So the People page can show how long a pending account has been waiting.
    created_at: datetime

    @classmethod
    def from_user(cls, user) -> "UserOut":
        """Build from a User ORM instance with `role` eagerly loaded."""
        return cls(
            id=user.id,
            full_name=user.full_name,
            email=user.email,
            phone=user.phone,
            bar_council_id=user.bar_council_id,
            avatar_url=avatar_service.url_for(user),
            role_name=user.role.name,
            permissions=sorted(user.role.permissions or []),
            is_active=user.is_active,
            is_verified=user.is_verified,
            created_at=user.created_at,
        )


class UserUpdate(BaseModel):
    """Self-service profile edits. Only what is sent changes."""

    bar_council_id: str | None = Field(default=None, max_length=100)


class AvatarUploadRequest(BaseModel):
    content_type: str = Field(max_length=100)
    size: int = Field(gt=0)


class AvatarUploadTarget(BaseModel):
    key: str
    url: str


class AvatarConfirm(BaseModel):
    key: str = Field(max_length=255)
