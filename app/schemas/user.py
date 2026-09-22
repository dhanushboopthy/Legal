import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

# A 10-digit Indian mobile number, optionally with a +91/91/0 prefix — the
# form the Bar Council ID's own audience overwhelmingly has. Stored (and sent
# to MSG91) as the bare 10 digits.
_PHONE_RE = re.compile(r"^(?:\+?91|0)?([6-9]\d{9})$")


def _normalize_phone(value: str) -> str:
    digits_only = re.sub(r"[\s-]", "", value)
    match = _PHONE_RE.match(digits_only)
    if not match:
        raise ValueError("Enter a 10-digit Indian mobile number")
    return match.group(1)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: EmailStr
    phone: str | None
    bar_council_id: str | None
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
            role_name=user.role.name,
            permissions=sorted(user.role.permissions or []),
            is_active=user.is_active,
            is_verified=user.is_verified,
            created_at=user.created_at,
        )


class UserUpdate(BaseModel):
    """Self-service profile edits. Only what is sent changes. `phone` isn't
    here — it's set only through the OTP flow below (POST /users/me/phone/
    otp, then /verify), never written directly."""

    bar_council_id: str | None = Field(default=None, max_length=100)


class PhoneOtpRequest(BaseModel):
    phone: str

    @field_validator("phone")
    @classmethod
    def _valid_phone(cls, value: str) -> str:
        return _normalize_phone(value)


class PhoneOtpVerify(BaseModel):
    phone: str
    code: str = Field(min_length=6, max_length=6)

    @field_validator("phone")
    @classmethod
    def _valid_phone(cls, value: str) -> str:
        return _normalize_phone(value)
