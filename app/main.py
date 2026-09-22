import structlog
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.config import settings
from app.core.exceptions import AppError
from app.core.rate_limit import limiter
from app.database import engine
from app.middleware import RequestContextMiddleware
from app.routers import auth, cases, config, documents, messages, notifications, payments, users, webhooks, ws

logger = structlog.get_logger()

app = FastAPI(
    title="Advocate Case Filing Platform",
    description="RBAC-based case intake, review, and drafting workflow API",
    version="1.0.0",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestContextMiddleware)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    logger.warning("app_error", path=str(request.url), status=exc.status_code, detail=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("unhandled_exception", path=str(request.url), error=str(exc))
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An unexpected error occurred"},
    )


@app.get("/health", tags=["health"])
async def health():
    """Readiness probe: verifies the database is actually reachable rather
    than just returning a static 200, matching docker-compose's own
    `pg_isready`-based healthcheck on the db service."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        logger.error("health_check_failed", error=str(exc))
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unhealthy", "environment": settings.environment},
        )
    return {"status": "ok", "environment": settings.environment}


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(cases.router)
app.include_router(documents.router)
app.include_router(payments.router)
app.include_router(notifications.router)
app.include_router(webhooks.router)
app.include_router(config.router)
app.include_router(messages.router)
app.include_router(ws.router)
