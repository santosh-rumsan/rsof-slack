"""User-facing JWT-secured endpoints — users can only see their own data."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import verify_jwt
from app.database import get_session
from app.models.schemas import (
    DurationSummaryOut,
    PresenceHistoryOut,
    SlackUserOut,
    StatusHistoryOut,
)
from app.models.slack_user import PresenceHistory, SlackUser, StatusHistory, UserMapping
from app.routers.admin import _compute_duration_summary

router = APIRouter()


async def _get_slack_id_for_jwt(payload: dict, session: AsyncSession) -> str:
    """Look up slack_id for the authenticated user via user_mappings."""
    internal_id = payload.get("sub")
    result = await session.execute(
        select(UserMapping).where(UserMapping.id == internal_id)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(
            status_code=404, detail="No Slack account linked to your user ID"
        )
    return mapping.slack_id


@router.get("/me", response_model=SlackUserOut)
async def get_me(
    payload: dict = Depends(verify_jwt),
    session: AsyncSession = Depends(get_session),
):
    slack_id = await _get_slack_id_for_jwt(payload, session)
    result = await session.execute(
        select(SlackUser).where(SlackUser.slack_id == slack_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/me/presence-history", response_model=list[PresenceHistoryOut])
async def get_my_presence_history(
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    payload: dict = Depends(verify_jwt),
    session: AsyncSession = Depends(get_session),
):
    slack_id = await _get_slack_id_for_jwt(payload, session)
    stmt = select(PresenceHistory).where(PresenceHistory.slack_id == slack_id)
    if from_dt:
        stmt = stmt.where(PresenceHistory.recorded_at >= from_dt)
    if to_dt:
        stmt = stmt.where(PresenceHistory.recorded_at <= to_dt)
    stmt = stmt.order_by(PresenceHistory.recorded_at)
    result = await session.execute(stmt)
    return result.scalars().all()


@router.get("/me/status-history", response_model=list[StatusHistoryOut])
async def get_my_status_history(
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    payload: dict = Depends(verify_jwt),
    session: AsyncSession = Depends(get_session),
):
    slack_id = await _get_slack_id_for_jwt(payload, session)
    stmt = select(StatusHistory).where(StatusHistory.slack_id == slack_id)
    if from_dt:
        stmt = stmt.where(StatusHistory.recorded_at >= from_dt)
    if to_dt:
        stmt = stmt.where(StatusHistory.recorded_at <= to_dt)
    stmt = stmt.order_by(StatusHistory.recorded_at)
    result = await session.execute(stmt)
    return result.scalars().all()


@router.get("/me/duration-summary", response_model=DurationSummaryOut)
async def get_my_duration_summary(
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    payload: dict = Depends(verify_jwt),
    session: AsyncSession = Depends(get_session),
):
    slack_id = await _get_slack_id_for_jwt(payload, session)
    return await _compute_duration_summary(session, slack_id, from_dt, to_dt)
