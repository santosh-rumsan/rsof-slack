from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SlackUser(Base):
    __tablename__ = "slack_users"

    slack_id: Mapped[str] = mapped_column(String, primary_key=True)
    real_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    current_presence: Mapped[Optional[str]] = mapped_column(
        String(10), nullable=True
    )  # 'active' | 'away'
    current_status_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    current_status_emoji: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )
    is_busy: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_dnd: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_presence_update: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    presence_history: Mapped[list["PresenceHistory"]] = relationship(
        back_populates="user", lazy="noload"
    )
    status_history: Mapped[list["StatusHistory"]] = relationship(
        back_populates="user", lazy="noload"
    )
    user_mapping: Mapped[Optional["UserMapping"]] = relationship(
        back_populates="slack_user", lazy="noload"
    )


class PresenceHistory(Base):
    __tablename__ = "presence_history"
    __table_args__ = (
        Index("ix_presence_history_slack_id_recorded_at", "slack_id", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    slack_id: Mapped[str] = mapped_column(
        String, ForeignKey("slack_users.slack_id"), nullable=False
    )
    presence: Mapped[str] = mapped_column(
        String(10), nullable=False
    )  # 'active' | 'away'
    source: Mapped[str] = mapped_column(String(10), nullable=False)  # 'rtm' | 'poll'
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["SlackUser"] = relationship(back_populates="presence_history")


class StatusHistory(Base):
    __tablename__ = "status_history"
    __table_args__ = (
        Index("ix_status_history_slack_id_recorded_at", "slack_id", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    slack_id: Mapped[str] = mapped_column(
        String, ForeignKey("slack_users.slack_id"), nullable=False
    )
    status_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status_emoji: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_busy: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_dnd: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["SlackUser"] = relationship(back_populates="status_history")


class UserMapping(Base):
    __tablename__ = "user_mappings"

    id: Mapped[str] = mapped_column(
        String, primary_key=True
    )  # internal user mgmt ID (== jwt.sub)
    slack_id: Mapped[str] = mapped_column(
        String, ForeignKey("slack_users.slack_id"), unique=True, nullable=False
    )
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    slack_user: Mapped["SlackUser"] = relationship(back_populates="user_mapping")
