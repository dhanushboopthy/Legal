from fastapi import APIRouter, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.core.exceptions import UnauthorizedError, ValidationAppError
from app.database import get_db
from app.services import payment_service

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/razorpay")
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
        )
        await db.commit()
    # Other events (payment.failed, order.paid, refund.processed, ...) can be
    # added here following the same pattern — look them up, act, commit.

    return {"status": "ok"}
