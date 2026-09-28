"""Profile pictures. The browser crops and shrinks the picture, PUTs it to a
presigned URL under avatars/{user_id}/, then confirms it here; the api checks
the object (where it is, its size, its first bytes) before pointing the user at
it. Pictures are shown through presigned GET URLs, never served by the api."""

import uuid

from app.core.exceptions import ValidationAppError
from app.models.user import User
from app.services import storage_service

MAX_AVATAR_BYTES = 2 * 1024 * 1024
# A presigned picture URL lasts an hour; the browser reuses one per picture
# (see web src/lib/avatar-url.ts) so it is fetched once, not on every poll.
AVATAR_URL_SECONDS = 3600

# content type -> (file extension, signatures the file may start with)
AVATAR_TYPES: dict[str, tuple[str, tuple[bytes, ...]]] = {
    "image/jpeg": (".jpg", (b"\xff\xd8\xff",)),
    "image/png": (".png", (b"\x89PNG\r\n\x1a\n",)),
}


def _prefix(user: User) -> str:
    return f"avatars/{user.id}/"


def upload_target(user: User, *, content_type: str, size: int) -> tuple[str, str]:
    """(key, presigned PUT url), with the type and size signed in."""
    kind = AVATAR_TYPES.get(content_type)
    if kind is None:
        raise ValidationAppError("Choose a JPEG or PNG picture")
    if not 0 < size <= MAX_AVATAR_BYTES:
        raise ValidationAppError("The picture must be 2 MB or smaller")
    key = f"{_prefix(user)}{uuid.uuid4()}{kind[0]}"
    url = storage_service.generate_presigned_upload_url(key, content_type=content_type, size=size)
    return key, url


async def confirm(user: User, key: str) -> str | None:
    """Point the user at an uploaded picture after checking it. Returns the
    previous key, for the caller to delete once the change is committed."""
    if not key.startswith(_prefix(user)) or "/" in key[len(_prefix(user)):]:
        raise ValidationAppError("That picture doesn't belong to your account")
    kind = next((k for k in AVATAR_TYPES.values() if key.endswith(k[0])), None)
    info = await storage_service.head_object(key)
    if kind is None or info is None:
        raise ValidationAppError("The picture wasn't uploaded. Please try again")
    head = await storage_service.read_head(key, 16)
    if info.size > MAX_AVATAR_BYTES or not any(head.startswith(sig) for sig in kind[1]):
        await storage_service.delete_object(key)
        raise ValidationAppError("That file isn't a JPEG or PNG picture of 2 MB or less")
    previous, user.avatar_key = user.avatar_key, key
    return previous if previous != key else None


def remove(user: User) -> str | None:
    previous, user.avatar_key = user.avatar_key, None
    return previous


def url_for(user: User) -> str | None:
    if not user.avatar_key:
        return None
    return storage_service.generate_presigned_download_url(
        user.avatar_key, expires_in=AVATAR_URL_SECONDS,
    )
