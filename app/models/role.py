import uuid

from sqlalchemy import ARRAY, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import UUIDPrimaryKeyMixin


class Role(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    # Denormalized permission list for fast in-memory checks; the
    # authoritative default set lives in app.core.permissions.ROLE_PERMISSIONS
    # and is written here at seed time so it can still be edited per-deployment.
    permissions: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)

    users: Mapped[list["User"]] = relationship(back_populates="role")
