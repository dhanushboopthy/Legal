import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()

MSG91_OTP_URL = "https://control.msg91.com/api/v5/otp"


def is_configured() -> bool:
    return bool(settings.msg91_auth_key and settings.msg91_template_id)


async def send_otp_sms(to_phone: str, code: str) -> None:
    """Send one OTP code by SMS via MSG91. Raises if MSG91 isn't configured
    or refuses the request."""
    # Dev convenience only: with MSG91 unconfigured (or even configured, if
    # you just want to watch the flow) the code is visible in logs — but
    # only when DEBUG is on, so a raw OTP never lands in production logs.
    if settings.debug:
        logger.info("phone_otp_code_debug", phone=to_phone, code=code)

    if not is_configured():
        raise RuntimeError("MSG91 is not configured (msg91_auth_key/msg91_template_id are empty)")

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            MSG91_OTP_URL,
            params={
                "template_id": settings.msg91_template_id,
                "mobile": to_phone,
                "otp": code,
                "authkey": settings.msg91_auth_key,
            },
        )
        response.raise_for_status()
        body = response.json()
        if body.get("type") != "success":
            raise RuntimeError(f"MSG91 refused the OTP send: {body.get('message', body)}")
