from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    debug: bool = False

    secret_key: str
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    algorithm: str = "HS256"

    database_url: str
    redis_url: str = "redis://localhost:6379/0"

    cors_origins: str = "http://localhost:3000"

    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "ap-south-1"
    s3_bucket_name: str = ""
    s3_presigned_url_expire_seconds: int = 300
    # Empty = real AWS S3. Otherwise the browser-reachable URL of an
    # S3-compatible store (self-hosted SeaweedFS in docker-compose) — it is
    # baked into presigned URLs, which the browser calls directly.
    s3_endpoint_url: str = ""
    # Address the api itself uses to read objects back (checking a draft is a
    # real PDF, counting its pages). Inside docker that is the storage
    # service, not the browser-facing URL above. Empty = same as the public one.
    s3_internal_endpoint_url: str = ""

    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    google_client_id: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_tls: bool = True

    review_fee_inr: int = 100
    # The advocate prices each case when sending the draft; the server clamps
    # that price to this range (catches typos like 25 or 2500000).
    quote_min_inr: int = 100
    quote_max_inr: int = 100000
    max_file_size_mb: int = 25
    # Intake limits (docs/NEW_FLOW_SPEC.md D7): per submission and per case.
    max_files_per_case: int = 10
    max_case_size_mb: int = 100
    # A draft case nobody submitted is deleted (with its files) after this many
    # days without a change; the worker service does the sweeping.
    draft_retention_days: int = 7
    worker_interval_seconds: int = 60

    # Where the web app lives, for links in emails ("open the case").
    app_base_url: str = "http://localhost:3100"
    # An unread chat message is emailed after this long, at most once per case
    # per this many minutes, and never with the message text in it.
    chat_email_after_minutes: int = 10
    chat_email_min_gap_minutes: int = 60

    # The approval gate stays manual, but a pending account this old gets its
    # admin(s) nudged (once per gap, not every sweep) rather than sitting
    # forgotten indefinitely.
    pending_approval_reminder_after_hours: int = 48
    pending_approval_reminder_gap_hours: int = 24

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
