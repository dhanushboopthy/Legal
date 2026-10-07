from google.auth.exceptions import TransportError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.config import settings


class GoogleTokenError(Exception):
    pass


class GoogleUnavailableError(Exception):
    """Google's signing keys couldn't be fetched (network/DNS), not a bad credential."""


def verify_google_id_token(token: str) -> dict:
    """Verifies a Google Identity Services credential (signature, expiry,
    audience) and returns its payload. Raises GoogleTokenError on any
    failure — callers should treat that as an authentication failure, not
    surface Google's internal exception details."""
    if not settings.google_client_id:
        raise GoogleTokenError("Google sign-in is not configured")
    try:
        payload = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), settings.google_client_id,
        )
    except TransportError as exc:
        raise GoogleUnavailableError("Google sign-in is temporarily unavailable") from exc
    except ValueError as exc:
        raise GoogleTokenError("Invalid Google credential") from exc

    if not payload.get("email_verified"):
        raise GoogleTokenError("Google account email is not verified")
    if not payload.get("email"):
        raise GoogleTokenError("Google credential did not include an email")

    return payload
