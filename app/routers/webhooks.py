from fastapi import APIRouter, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.core.exceptions import UnauthorizedError, ValidationAppError
from app.core.rate_limit import limiter
from app.database import get_db
from app.services import payment_service

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/razorpay")
@limiter.exempt
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    raw_body = await request.body()

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
    # Other events (order.paid, ...) can be added here following the same
    # pattern — look them up, act, commit.

    return {"status": "ok"}
