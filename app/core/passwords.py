"""Rules for a new password (registration, reset). Sign-in accepts any
existing password, so tightening these never locks anyone out."""
from app.core.security import BCRYPT_MAX_BYTES

MIN_LENGTH = 10

# Common choices that pass the length rule. Most of the well-known leaked
# lists are shorter than 10 characters and already fail on length.
_COMMON = {
    "1234567890", "0987654321", "12345678910", "123456789012", "1111111111",
    "0000000000", "qwertyuiop", "1q2w3e4r5t", "1qaz2wsx3edc", "qwerty12345",
    "qwerty123456", "password12", "password123", "password1234", "passw0rd123",
    "password@123", "password#123", "iloveyou12", "iloveyou123", "welcome123",
    "welcome@123", "admin12345", "admin@1234", "letmein123", "sunshine12",
    "princess12", "football12", "baseball12", "abcdefghij", "abcd123456",
    "abc@123456", "abcd@12345", "india12345", "india@123", "changeme123",
    "monkey12345", "dragon12345", "master12345", "superman123", "trustno1234",
    "lawyer12345", "advocate123", "advocate@123", "legal12345",
}


def password_problem(password: str, email: str | None = None) -> str | None:
    """A plain-English reason the password can't be used, or None if it's fine."""
    if len(password) < MIN_LENGTH:
        return f"Use at least {MIN_LENGTH} characters."
    if len(password.encode()) > BCRYPT_MAX_BYTES:
        return f"Use at most {BCRYPT_MAX_BYTES} characters."
    lowered = password.lower()
    if lowered in _COMMON or len(set(lowered)) <= 2:
        return "This password is too easy to guess. Try a short phrase you'll remember."
    if email:
        name = email.split("@", 1)[0].lower()
        if len(name) >= 4 and name in lowered:
            return "Don't include your email address in your password."
    return None
