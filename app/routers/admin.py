"""Admin API — secured by X-API-Key header."""

import asyncio
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import verify_api_key
from app.database import get_session
from app.models.schemas import (
    ActiveHoursRow,
    AvailabilityRow,
    CurrentlyActiveOut,
    DndPatternRow,
    DurationEntry,
    DurationSummaryOut,
    InactiveUserRow,
    JobStatus,
    MessageOut,
    PresenceHistoryOut,
    PresenceSummaryRow,
    SlackUserOut,
    StatusHistoryOut,
    StatusTrendRow,
    SyncStatusOut,
)
from app.models.slack_user import PresenceHistory, SlackUser, StatusHistory, UserMapping
from app.services import slack_sync, user_mapping_sync
from app.services.slack_monitor import _presence_listeners

router = APIRouter(dependencies=[Depends(verify_api_key)])

# Scheduler reference — set by main.py after scheduler is created
_scheduler = None


def set_scheduler(scheduler) -> None:
    global _scheduler
    _scheduler = scheduler


# ---------------------------------------------------------------------------
# Sync triggers
# ---------------------------------------------------------------------------


@router.post("/sync/slack-users", response_model=MessageOut)
async def trigger_slack_user_sync():
    """Trigger an immediate Slack user sync."""
    stats = await slack_sync.sync_slack_users()
    return MessageOut(message=f"Sync complete: {stats}")


@router.post("/sync/user-mappings", response_model=MessageOut)
async def trigger_user_mapping_sync():
    """Trigger an immediate user mapping sync from the user management API."""
    stats = await user_mapping_sync.sync_user_mappings()
    return MessageOut(message=f"Sync complete: {stats}")


@router.post("/sync/presence", response_model=MessageOut)
async def trigger_presence_sync():
    """Pull and reconcile presence for all active users (only writes on change)."""
    stats = await slack_sync.reconcile_presence()
    return MessageOut(message=f"Reconciliation complete: {stats}")


@router.get("/sync/status", response_model=SyncStatusOut)
async def get_sync_status():
    """Return last/next run times for each scheduled job."""
    if _scheduler is None:
        return SyncStatusOut(jobs=[])
    jobs = []
    for job in _scheduler.get_jobs():
        jobs.append(
            JobStatus(
                job_id=job.id,
                last_run=None,  # APScheduler doesn't expose last_run directly without a listener
                next_run=job.next_run_time,
            )
        )
    return SyncStatusOut(jobs=jobs)


# ---------------------------------------------------------------------------
# Server-Sent Events
# ---------------------------------------------------------------------------

@router.get("/events/presence")
async def presence_event_stream(request: Request):
    """Stream real-time presence changes as SSE."""
    q: asyncio.Queue = asyncio.Queue()
    _presence_listeners.append(q)

    async def generate():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _presence_listeners.remove(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@router.get("/users", response_model=list[SlackUserOut])
async def list_users(
    ids: Optional[str] = Query(None, description="Comma-separated slack_ids"),
    presence: Optional[str] = Query(
        None, description="Filter by presence: active | away"
    ),
    active_only: bool = Query(True),
    session: AsyncSession = Depends(get_session),
):
    """List users. Filter by ids, presence, or active status."""
    stmt = select(SlackUser)
    if active_only:
        stmt = stmt.where(SlackUser.is_active == True)  # noqa: E712
    if ids:
        id_list = [i.strip() for i in ids.split(",") if i.strip()]
        stmt = stmt.where(SlackUser.slack_id.in_(id_list))
    if presence:
        stmt = stmt.where(SlackUser.current_presence == presence)
    stmt = stmt.order_by(SlackUser.real_name)
    result = await session.execute(stmt)
    return result.scalars().all()


@router.get("/users/{slack_id}", response_model=SlackUserOut)
async def get_user(slack_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(SlackUser).where(SlackUser.slack_id == slack_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get(
    "/users/{slack_id}/presence-history", response_model=list[PresenceHistoryOut]
)
async def get_user_presence_history(
    slack_id: str,
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(PresenceHistory).where(PresenceHistory.slack_id == slack_id)
    if from_dt:
        stmt = stmt.where(PresenceHistory.recorded_at >= from_dt)
    if to_dt:
        stmt = stmt.where(PresenceHistory.recorded_at <= to_dt)
    stmt = stmt.order_by(PresenceHistory.recorded_at)
    result = await session.execute(stmt)
    return result.scalars().all()


@router.get("/users/{slack_id}/status-history", response_model=list[StatusHistoryOut])
async def get_user_status_history(
    slack_id: str,
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(StatusHistory).where(StatusHistory.slack_id == slack_id)
    if from_dt:
        stmt = stmt.where(StatusHistory.recorded_at >= from_dt)
    if to_dt:
        stmt = stmt.where(StatusHistory.recorded_at <= to_dt)
    stmt = stmt.order_by(StatusHistory.recorded_at)
    result = await session.execute(stmt)
    return result.scalars().all()


@router.get("/users/{slack_id}/duration-summary", response_model=DurationSummaryOut)
async def get_user_duration_summary(
    slack_id: str,
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
):
    return await _compute_duration_summary(session, slack_id, from_dt, to_dt)


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


@router.get("/reports/currently-active", response_model=CurrentlyActiveOut)
async def report_currently_active(session: AsyncSession = Depends(get_session)):
    stmt = select(SlackUser).where(
        SlackUser.current_presence == "active", SlackUser.is_active == True
    )  # noqa: E712
    result = await session.execute(stmt)
    users = result.scalars().all()
    return CurrentlyActiveOut(count=len(users), users=users)


@router.get("/reports/presence-summary", response_model=list[PresenceSummaryRow])
async def report_presence_summary(
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
):
    """Per-user active/away duration totals using LEAD() window function."""
    where_clauses = []
    if from_dt:
        where_clauses.append(f"recorded_at >= '{from_dt.isoformat()}'")
    if to_dt:
        where_clauses.append(f"recorded_at <= '{to_dt.isoformat()}'")
    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    sql = text(f"""
        WITH ordered AS (
            SELECT
                slack_id,
                presence,
                recorded_at,
                LEAD(recorded_at) OVER (PARTITION BY slack_id ORDER BY recorded_at) AS next_at
            FROM presence_history
            {where_sql}
        ),
        durations AS (
            SELECT
                slack_id,
                presence,
                EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - recorded_at)) AS seconds
            FROM ordered
        ),
        agg AS (
            SELECT
                slack_id,
                SUM(CASE WHEN presence = 'active' THEN seconds ELSE 0 END) AS active_seconds,
                SUM(CASE WHEN presence = 'away' THEN seconds ELSE 0 END) AS away_seconds
            FROM durations
            GROUP BY slack_id
        )
        SELECT
            a.slack_id,
            u.real_name,
            u.display_name,
            a.active_seconds,
            a.away_seconds,
            CASE WHEN (a.active_seconds + a.away_seconds) > 0
                 THEN ROUND((a.active_seconds / (a.active_seconds + a.away_seconds) * 100)::numeric, 2)
                 ELSE 0 END AS availability_pct
        FROM agg a
        JOIN slack_users u ON u.slack_id = a.slack_id
        ORDER BY availability_pct DESC
    """)
    result = await session.execute(sql)
    return [
        PresenceSummaryRow(
            slack_id=row.slack_id,
            real_name=row.real_name,
            display_name=row.display_name,
            active_seconds=float(row.active_seconds),
            away_seconds=float(row.away_seconds),
            availability_pct=float(row.availability_pct),
        )
        for row in result.all()
    ]


@router.get("/reports/active-hours", response_model=list[ActiveHoursRow])
async def report_active_hours(
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
):
    """Hourly heatmap: how many user-presence-active records fall in each day×hour bucket."""
    where_clauses = ["presence = 'active'"]
    if from_dt:
        where_clauses.append(f"recorded_at >= '{from_dt.isoformat()}'")
    if to_dt:
        where_clauses.append(f"recorded_at <= '{to_dt.isoformat()}'")
    where_sql = "WHERE " + " AND ".join(where_clauses)

    sql = text(f"""
        SELECT
            EXTRACT(ISODOW FROM recorded_at)::int - 1 AS day_of_week,
            EXTRACT(HOUR FROM recorded_at)::int AS hour_of_day,
            COUNT(*) AS count
        FROM presence_history
        {where_sql}
        GROUP BY 1, 2
        ORDER BY 1, 2
    """)
    result = await session.execute(sql)
    return [
        ActiveHoursRow(
            day_of_week=row.day_of_week, hour_of_day=row.hour_of_day, count=row.count
        )
        for row in result.all()
    ]


@router.get("/reports/availability", response_model=list[AvailabilityRow])
async def report_availability(
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
):
    """Availability percentage per user over a date range (re-uses presence-summary logic)."""
    rows = await report_presence_summary(from_dt=from_dt, to_dt=to_dt, session=session)
    return [
        AvailabilityRow(
            slack_id=r.slack_id,
            real_name=r.real_name,
            display_name=r.display_name,
            availability_pct=r.availability_pct,
        )
        for r in rows
    ]


@router.get("/reports/dnd-patterns", response_model=list[DndPatternRow])
async def report_dnd_patterns(
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
):
    where_clauses = ["is_dnd = true"]
    if from_dt:
        where_clauses.append(f"recorded_at >= '{from_dt.isoformat()}'")
    if to_dt:
        where_clauses.append(f"recorded_at <= '{to_dt.isoformat()}'")
    where_sql = "WHERE " + " AND ".join(where_clauses)

    sql = text(f"""
        WITH dnd_sessions AS (
            SELECT
                slack_id,
                recorded_at,
                LEAD(recorded_at) OVER (PARTITION BY slack_id ORDER BY recorded_at) AS next_at
            FROM status_history
            {where_sql}
        )
        SELECT
            d.slack_id,
            u.real_name,
            u.display_name,
            COUNT(*) AS dnd_count,
            AVG(EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - recorded_at))) AS avg_duration_seconds
        FROM dnd_sessions d
        JOIN slack_users u ON u.slack_id = d.slack_id
        GROUP BY d.slack_id, u.real_name, u.display_name
        ORDER BY dnd_count DESC
    """)
    result = await session.execute(sql)
    return [
        DndPatternRow(
            slack_id=row.slack_id,
            real_name=row.real_name,
            display_name=row.display_name,
            dnd_count=row.dnd_count,
            avg_duration_seconds=float(row.avg_duration_seconds)
            if row.avg_duration_seconds
            else None,
        )
        for row in result.all()
    ]


@router.get("/reports/status-trends", response_model=list[StatusTrendRow])
async def report_status_trends(
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(20),
    session: AsyncSession = Depends(get_session),
):
    where_clauses = ["(status_text IS NOT NULL OR status_emoji IS NOT NULL)"]
    if from_dt:
        where_clauses.append(f"recorded_at >= '{from_dt.isoformat()}'")
    if to_dt:
        where_clauses.append(f"recorded_at <= '{to_dt.isoformat()}'")
    where_sql = "WHERE " + " AND ".join(where_clauses)

    sql = text(f"""
        SELECT status_text, status_emoji, COUNT(*) AS count
        FROM status_history
        {where_sql}
        GROUP BY status_text, status_emoji
        ORDER BY count DESC
        LIMIT :limit
    """)
    result = await session.execute(sql, {"limit": limit})
    return [
        StatusTrendRow(
            status_text=row.status_text, status_emoji=row.status_emoji, count=row.count
        )
        for row in result.all()
    ]


@router.get("/reports/inactive-users", response_model=list[InactiveUserRow])
async def report_inactive_users(
    days: int = Query(
        7, description="Users with no active presence in the last N days"
    ),
    session: AsyncSession = Depends(get_session),
):
    sql = text("""
        SELECT slack_id, real_name, display_name, last_presence_update
        FROM slack_users
        WHERE is_active = true
          AND (
              last_presence_update IS NULL
              OR last_presence_update < NOW() - INTERVAL ':days days'
              OR current_presence = 'away'
          )
        ORDER BY last_presence_update ASC NULLS FIRST
    """)
    result = await session.execute(sql, {"days": days})
    return [
        InactiveUserRow(
            slack_id=row.slack_id,
            real_name=row.real_name,
            display_name=row.display_name,
            last_presence_update=row.last_presence_update,
        )
        for row in result.all()
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _compute_duration_summary(
    session: AsyncSession,
    slack_id: str,
    from_dt: Optional[datetime],
    to_dt: Optional[datetime],
) -> DurationSummaryOut:
    where_clauses = [f"slack_id = '{slack_id}'"]
    if from_dt:
        where_clauses.append(f"recorded_at >= '{from_dt.isoformat()}'")
    if to_dt:
        where_clauses.append(f"recorded_at <= '{to_dt.isoformat()}'")
    where_sql = "WHERE " + " AND ".join(where_clauses)

    sql = text(f"""
        WITH ordered AS (
            SELECT
                presence,
                recorded_at,
                LEAD(recorded_at) OVER (ORDER BY recorded_at) AS next_at
            FROM presence_history
            {where_sql}
        )
        SELECT
            presence,
            SUM(EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - recorded_at))) AS total_seconds
        FROM ordered
        GROUP BY presence
    """)
    result = await session.execute(sql)
    durations = [
        DurationEntry(presence=row.presence, total_seconds=float(row.total_seconds))
        for row in result.all()
    ]
    return DurationSummaryOut(
        slack_id=slack_id, from_dt=from_dt, to_dt=to_dt, durations=durations
    )
