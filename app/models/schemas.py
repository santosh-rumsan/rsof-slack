from datetime import datetime
from typing import Optional

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# SlackUser
# ---------------------------------------------------------------------------


class SlackUserOut(BaseModel):
    slack_id: str
    real_name: Optional[str]
    display_name: Optional[str]
    email: Optional[str]
    avatar_url: Optional[str]
    is_active: bool
    current_presence: Optional[str]
    current_status_text: Optional[str]
    current_status_emoji: Optional[str]
    is_busy: bool
    is_dnd: bool
    last_presence_update: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Presence / Status history
# ---------------------------------------------------------------------------


class PresenceHistoryOut(BaseModel):
    id: int
    slack_id: str
    presence: str
    source: str
    recorded_at: datetime

    model_config = {"from_attributes": True}


class StatusHistoryOut(BaseModel):
    id: int
    slack_id: str
    status_text: Optional[str]
    status_emoji: Optional[str]
    is_busy: bool
    is_dnd: bool
    recorded_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Duration summary (computed, not a DB model)
# ---------------------------------------------------------------------------


class DurationEntry(BaseModel):
    presence: str
    total_seconds: float


class DurationSummaryOut(BaseModel):
    slack_id: str
    from_dt: Optional[datetime]
    to_dt: Optional[datetime]
    durations: list[DurationEntry]


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


class PresenceSummaryRow(BaseModel):
    slack_id: str
    real_name: Optional[str]
    display_name: Optional[str]
    active_seconds: float
    away_seconds: float
    availability_pct: float


class ActiveHoursRow(BaseModel):
    day_of_week: int  # 0=Mon … 6=Sun
    hour_of_day: int  # 0-23
    count: int


class AvailabilityRow(BaseModel):
    slack_id: str
    real_name: Optional[str]
    display_name: Optional[str]
    availability_pct: float


class DndPatternRow(BaseModel):
    slack_id: str
    real_name: Optional[str]
    display_name: Optional[str]
    dnd_count: int
    avg_duration_seconds: Optional[float]


class StatusTrendRow(BaseModel):
    status_text: Optional[str]
    status_emoji: Optional[str]
    count: int


class CurrentlyActiveOut(BaseModel):
    count: int
    users: list[SlackUserOut]


class InactiveUserRow(BaseModel):
    slack_id: str
    real_name: Optional[str]
    display_name: Optional[str]
    last_presence_update: Optional[datetime]


# ---------------------------------------------------------------------------
# Sync status
# ---------------------------------------------------------------------------


class JobStatus(BaseModel):
    job_id: str
    last_run: Optional[datetime]
    next_run: Optional[datetime]


class SyncStatusOut(BaseModel):
    jobs: list[JobStatus]


# ---------------------------------------------------------------------------
# Generic responses
# ---------------------------------------------------------------------------


class MessageOut(BaseModel):
    message: str
