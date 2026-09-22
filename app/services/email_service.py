import asyncio
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import structlog

from app.config import settings

logger = structlog.get_logger()


def _send_sync(to_email: str, subject: str, text_body: str, html_body: str) -> None:
    if not settings.smtp_host:
        raise RuntimeError("SMTP is not configured (smtp_host is empty)")

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = settings.smtp_from_email or settings.smtp_username
    message["To"] = to_email
    message.attach(MIMEText(text_body, "plain"))
    message.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_use_tls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password)
        client.sendmail(message["From"], [to_email], message.as_string())


async def send_email(to_email: str, subject: str, text_body: str, html_body: str) -> None:
    """Send one email. Raises if SMTP isn't configured or the server refuses."""
    await asyncio.to_thread(_send_sync, to_email, subject, text_body, html_body)


def is_configured() -> bool:
    return bool(settings.smtp_host)


async def send_otp_email(to_email: str, code: str) -> None:
    # Dev convenience only: with real SMTP unconfigured (or even configured,
    # if you just want to watch the flow) the code is visible in logs — but
    # only when DEBUG is on, so a raw OTP never lands in production logs.
    if settings.debug:
        logger.info("otp_code_debug", email=to_email, code=code)

    subject = "Your verification code"
    text_body = f"Your verification code is {code}. It expires in 10 minutes."
    html_body = (
        f"<p>Your verification code is <strong>{code}</strong>.</p>"
        "<p>It expires in 10 minutes.</p>"
    )
    await asyncio.to_thread(_send_sync, to_email, subject, text_body, html_body)
