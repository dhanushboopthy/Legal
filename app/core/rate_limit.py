from fastapi import Request
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings


def rate_limit_key(request: Request) -> str:
    """Key by the authenticated user (from the JWT, undecoded validity is
    fine here — it's a rate-limit bucket, not an auth check) so one user
    can't dodge the limit by rotating IPs, falling back to remote address
    for unauthenticated requests."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:]
        try:
            payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        except JWTError:
            payload = {}
        sub = payload.get("sub")
        if sub:
            return f"user:{sub}"
    return get_remote_address(request)


limiter = Limiter(key_func=rate_limit_key, default_limits=["100/minute"])
