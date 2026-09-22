"""What the platform accepts as a case file, in one place.

The browser names a file and its type; neither is trusted. The type is checked
against this table before a URL is signed, and the first bytes of the stored
object are checked against the same table before the file is filed."""

from dataclasses import dataclass


@dataclass(frozen=True)
class FileKind:
    content_type: str
    magic: tuple[bytes, ...]  # any of these may start the file


_JPEG = FileKind("image/jpeg", (b"\xff\xd8\xff",))

ALLOWED_KINDS: dict[str, FileKind] = {
    ".pdf": FileKind("application/pdf", (b"%PDF-",)),
    # Legacy Word is an OLE2 container.
    ".doc": FileKind("application/msword", (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",)),
    # .docx is a zip; this catches a renamed image or PDF, not a renamed zip.
    ".docx": FileKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        (b"PK\x03\x04",),
    ),
    ".png": FileKind("image/png", (b"\x89PNG\r\n\x1a\n",)),
    ".jpg": _JPEG,
    ".jpeg": _JPEG,
}

# Long enough for the longest signature above.
MAGIC_READ_BYTES = 16

MAX_FILENAME_LENGTH = 255


def extension_of(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot != -1 else ""


def kind_for(filename: str) -> FileKind | None:
    return ALLOWED_KINDS.get(extension_of(filename))


def matches_magic(filename: str, head: bytes) -> bool:
    kind = kind_for(filename)
    return kind is not None and any(head.startswith(sig) for sig in kind.magic)


def is_clean_filename(filename: str) -> bool:
    """Non-empty, a sane length, and no control characters."""
    return (
        0 < len(filename) <= MAX_FILENAME_LENGTH
        and filename.strip() != ""
        and not any(ord(ch) < 32 or ord(ch) == 127 for ch in filename)
    )
