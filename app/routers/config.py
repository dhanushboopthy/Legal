from fastapi import APIRouter, Depends

from app.config import settings
from app.core import uploads
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.upload import PricingOut, SupportOut, UploadRulesOut

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/pricing", response_model=PricingOut)
async def get_pricing(current_user: User = Depends(get_current_user)):
    """The fee shown on the button that spends it comes from here, never from
    a number baked into the UI."""
    return PricingOut(
        review_fee_inr=settings.review_fee_inr,
        quote_min_inr=settings.quote_min_inr,
        quote_max_inr=settings.quote_max_inr,
    )


@router.get("/support", response_model=SupportOut)
async def get_support():
    """Public: someone who can't sign in is who most needs a phone number."""
    return SupportOut(
        email=settings.support_email or None,
        phone=settings.support_phone or None,
        hours=settings.support_hours or None,
    )


@router.get("/uploads", response_model=UploadRulesOut)
async def get_upload_rules(current_user: User = Depends(get_current_user)):
    return UploadRulesOut(
        max_files=settings.max_files_per_case,
        max_file_size_mb=settings.max_file_size_mb,
        max_case_size_mb=settings.max_case_size_mb,
        accepted={ext: kind.content_type for ext, kind in uploads.ALLOWED_KINDS.items()},
    )
