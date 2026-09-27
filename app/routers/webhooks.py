import structlog
from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import UnauthorizedError, ValidationAppError
from app.core.rate_limit import limiter
from app.database import get_db
from app.services import payment_service

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = structlog.get_logger()

# Razorpay's events are a few KB; anything much bigger isn't from Razorpay.
MAX_BODY_BYTES = 64 * 1024


@router.post("/razorpay")
@limiter.exempt
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if int(request.headers.get("content-length") or 0) > MAX_BODY_BYTES:
        raise ValidationAppError("Webhook body too large")
    raw_body = await request.body()
    if len(raw_body) > MAX_BODY_BYTES:
        raise ValidationAppError("Webhook body too large")

    if not payment_service.verify_webhook_signature(raw_body, x_razorpay_signature):
        raise UnauthorizedError("Invalid webhook signature")

    payload = await request.json()
    event = payload.get("event")

    if event == "payment.captured":
        entity = payload["payload"]["payment"]["entity"]
        await payment_service.handle_payment_captured(
            db, gateway_order_id=entity["order_id"], gateway_payment_id=entity["id"],
            amount_paise=entity["amount"], currency=entity.get("currency", "INR"),
        )
        await db.commit()
    elif event == "payment.failed":
        entity = payload["payload"]["payment"]["entity"]
        await payment_service.handle_payment_failed(
            db, gateway_order_id=entity["order_id"],
            error_description=entity.get("error_description"),
        )
        await db.commit()
    elif event == "refund.processed":
        entity = payload["payload"]["refund"]["entity"]
        await payment_service.handle_refund_processed(
            db, gateway_payment_id=entity["payment_id"],
        )
        await db.commit()
    else:
        # Acknowledged so Razorpay stops retrying; add a branch above to act
        # on a new event type (look it up, act, commit).
        logger.info("webhook_event_ignored", event=event)

    return {"status": "ok"}
