import asyncio
import uuid
from dataclasses import dataclass

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.config import settings


def _s3_client(endpoint_url: str):
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
        endpoint_url=endpoint_url or None,
        # Self-hosted S3-compatible stores are addressed by host:port, so they
        # need path-style (bucket in the URL path) — harmless for real AWS too.
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _signing_client():
    # Presigned URLs are handed to the browser, so they must be signed against
    # the address the browser can reach.
    return _s3_client(settings.s3_endpoint_url)


def _internal_client():
    # Reads made by the api itself go over the internal network instead.
    return _s3_client(settings.s3_internal_endpoint_url or settings.s3_endpoint_url)


def build_storage_key(case_id: uuid.UUID, filename: str) -> str:
    safe_name = filename.replace("/", "_").replace("\\", "_")
    return f"cases/{case_id}/{uuid.uuid4()}_{safe_name}"


def generate_presigned_upload_url(
    storage_key: str, content_type: str = "application/pdf", size: int | None = None,
) -> str:
    """The content type is signed in, and so is the size when given: the store
    rejects a PUT of any other type or length with SignatureDoesNotMatch, so the
    limits checked before signing can't be exceeded by the upload itself."""
    params = {
        "Bucket": settings.s3_bucket_name,
        "Key": storage_key,
        "ContentType": content_type,
    }
    if size is not None:
        params["ContentLength"] = size
    return _signing_client().generate_presigned_url(
        "put_object", Params=params, ExpiresIn=settings.s3_presigned_url_expire_seconds,
    )


def generate_presigned_download_url(storage_key: str) -> str:
    client = _signing_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket_name, "Key": storage_key},
        ExpiresIn=settings.s3_presigned_url_expire_seconds,
    )


# --- server-side reads --------------------------------------------------
# Used only to verify an upload (exists, size, file type, page count) and to
# clean up after it. The api never serves file bytes to users; downloads stay
# presigned.

@dataclass(frozen=True)
class ObjectInfo:
    size: int


def _head_object(storage_key: str) -> ObjectInfo | None:
    try:
        head = _internal_client().head_object(Bucket=settings.s3_bucket_name, Key=storage_key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise
    return ObjectInfo(size=int(head["ContentLength"]))


def _read_object(storage_key: str) -> bytes:
    response = _internal_client().get_object(Bucket=settings.s3_bucket_name, Key=storage_key)
    return response["Body"].read()


def _read_head(storage_key: str, length: int) -> bytes:
    # A ranged read: enough to recognise a file type without pulling the file.
    response = _internal_client().get_object(
        Bucket=settings.s3_bucket_name, Key=storage_key, Range=f"bytes=0-{length - 1}"
    )
    return response["Body"].read()


def _delete_object(storage_key: str) -> None:
    _internal_client().delete_object(Bucket=settings.s3_bucket_name, Key=storage_key)


def _delete_prefix(prefix: str) -> int:
    client = _internal_client()
    deleted = 0
    for page in client.get_paginator("list_objects_v2").paginate(
        Bucket=settings.s3_bucket_name, Prefix=prefix
    ):
        keys = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
        if keys:
            client.delete_objects(Bucket=settings.s3_bucket_name, Delete={"Objects": keys})
            deleted += len(keys)
    return deleted


# boto3 is blocking, so these run in a worker thread rather than stalling the
# event loop. Callers use `storage_service.head_object(...)` (module attribute)
# so tests can swap in an in-memory fake.
async def head_object(storage_key: str) -> ObjectInfo | None:
    return await asyncio.to_thread(_head_object, storage_key)


async def read_object(storage_key: str) -> bytes:
    return await asyncio.to_thread(_read_object, storage_key)


async def read_head(storage_key: str, length: int) -> bytes:
    return await asyncio.to_thread(_read_head, storage_key, length)


async def delete_object(storage_key: str) -> None:
    await asyncio.to_thread(_delete_object, storage_key)


async def delete_prefix(prefix: str) -> int:
    """Delete every object under a prefix, including uploads that were never
    filed as documents. Returns how many were removed."""
    return await asyncio.to_thread(_delete_prefix, prefix)
