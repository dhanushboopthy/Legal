import uuid

import boto3
from botocore.client import Config

from app.config import settings


def _s3_client():
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
        config=Config(signature_version="s3v4"),
    )


def build_storage_key(case_id: uuid.UUID, filename: str) -> str:
    safe_name = filename.replace("/", "_").replace("\\", "_")
    return f"cases/{case_id}/{uuid.uuid4()}_{safe_name}"


def generate_presigned_upload_url(storage_key: str, content_type: str = "application/pdf") -> str:
    client = _s3_client()
    return client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket_name,
            "Key": storage_key,
            "ContentType": content_type,
        },
        ExpiresIn=settings.s3_presigned_url_expire_seconds,
    )


def generate_presigned_download_url(storage_key: str) -> str:
    client = _s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket_name, "Key": storage_key},
        ExpiresIn=settings.s3_presigned_url_expire_seconds,
    )
