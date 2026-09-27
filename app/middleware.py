import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = structlog.get_logger()

# Dev-only interactive docs load Swagger/ReDoc from a CDN.
_DOCS_PATHS = ("/docs", "/redoc")


def _add_security_headers(path: str, headers) -> None:
    """The api only ever returns JSON, so nothing it sends may run script, be
    framed, or be content-sniffed into something else. nginx adds the page-level
    headers (HSTS, the SPA's CSP) in front of this."""
    headers.setdefault("X-Content-Type-Options", "nosniff")
    if not path.startswith(_DOCS_PATHS):
        headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    if path.startswith("/auth/"):
        headers["Cache-Control"] = "no-store"


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Binds a request id into structlog context for the life of the
    request and logs one line per response, so a user-reported error can be
    grepped by request id across every log line it touched."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        start = time.monotonic()
        response = await call_next(request)
        duration_ms = round((time.monotonic() - start) * 1000, 2)

        response.headers["X-Request-ID"] = request_id
        _add_security_headers(request.url.path, response.headers)
        logger.info(
            "request_completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
        return response
