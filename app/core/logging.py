import logging

import structlog


def mask_email(email: str) -> str:
    """Enough to tell two log lines apart, not enough to identify someone:
    priya.sharma@example.com -> p***@example.com"""
    name, _, domain = email.partition("@")
    return f"{name[:1]}***@{domain}" if domain else "***"


def configure_logging(*, production: bool) -> None:
    """JSON lines in production (for a log collector), readable console
    output elsewhere. Both carry the request id bound by the middleware."""
    renderer = structlog.processors.JSONRenderer() if production else structlog.dev.ConsoleRenderer()
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        cache_logger_on_first_use=True,
    )
