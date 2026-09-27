import jwt
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings


def client_ip(request: Request) -> str:
    """The api is reachable only through nginx (directly, or via the BFF, which
    passes nginx's header on), and nginx sets X-Real-IP to the connecting
    address. Without it every request would look like it came from the proxy
    and share one bucket. Behind a TLS load balancer, enable nginx's real_ip
    module so X-Real-IP stays the browser's address."""
    return request.headers.get("x-real-ip") or get_remote_address(request)


def rate_limit_key(request: Request) -> str:
    """Key by the authenticated user (from the JWT, undecoded validity is
    fine here — it's a rate-limit bucket, not an auth check) so one user
    can't dodge the limit by rotating IPs, falling back to the client address
    for unauthenticated requests."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:]
        try:
            payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        except jwt.PyJWTError:
            payload = {}
        sub = payload.get("sub")
        if sub:
            return f"user:{sub}"
    return client_ip(request)


# Counted in Redis so the limit is shared by all of the api's worker processes
# (in memory, each of the 4 gunicorn workers would allow its own quota).
# If Redis is unreachable the limiter falls back to counting in memory rather
# than failing requests. Tests count in memory: CI has no Redis.
# The default is a backstop against floods on routes with no limit of their
# own; it sits well above what polling screens in several tabs use.
limiter = Limiter(
    key_func=rate_limit_key,
    default_limits=["300/minute"],
    storage_uri="memory://" if settings.environment == "test" else settings.redis_url,
    in_memory_fallback_enabled=True,
)
