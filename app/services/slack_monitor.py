"""Slack RTM (Socket Mode) monitor.

Opens a persistent WebSocket via the App-Level Token, subscribes all active
users to presence events, and writes changes to the database.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from slack_sdk.socket_mode.aiohttp import SocketModeClient
from slack_sdk.socket_mode.request import SocketModeRequest
from slack_sdk.socket_mode.response import SocketModeResponse
from slack_sdk.web.async_client import AsyncWebClient
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session_factory
from app.models.slack_user import PresenceHistory, SlackUser, StatusHistory

logger = logging.getLogger(__name__)

# Shared state accessible from routers
rtm_connected: bool = False
_socket_client: SocketModeClient | None = None

# SSE broadcast queues — one per connected client
_presence_listeners: list[asyncio.Queue] = []


def _broadcast_presence_event(event: dict) -> None:
    for q in _presence_listeners:
        q.put_nowait(event)


async def _upsert_presence_change(slack_id: str, presence: str, source: str) -> bool:
    """Update slack_users.current_presence and append to presence_history.
    Returns True if the presence actually changed."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(SlackUser).where(SlackUser.slack_id == slack_id)
        )
        user = result.scalar_one_or_none()
        if user is None:
            return False

        if user.current_presence == presence:
            return False  # no change

        user.current_presence = presence
        user.last_presence_update = datetime.now(timezone.utc)
        session.add(
            PresenceHistory(slack_id=slack_id, presence=presence, source=source)
        )
        await session.commit()
        logger.debug("Presence change: %s → %s (%s)", slack_id, presence, source)
        _broadcast_presence_event({
            "slack_id": slack_id,
            "presence": presence,
            "source": source,
            "real_name": user.real_name,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        return True


async def _upsert_status_change(
    slack_id: str, status_text: str, status_emoji: str, is_busy: bool, is_dnd: bool
) -> None:
    """Update slack_users status fields and append to status_history if changed."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(SlackUser).where(SlackUser.slack_id == slack_id)
        )
        user = result.scalar_one_or_none()
        if user is None:
            return

        changed = (
            user.current_status_text != status_text
            or user.current_status_emoji != status_emoji
            or user.is_busy != is_busy
            or user.is_dnd != is_dnd
        )
        if not changed:
            return

        user.current_status_text = status_text
        user.current_status_emoji = status_emoji
        user.is_busy = is_busy
        user.is_dnd = is_dnd
        session.add(
            StatusHistory(
                slack_id=slack_id,
                status_text=status_text,
                status_emoji=status_emoji,
                is_busy=is_busy,
                is_dnd=is_dnd,
            )
        )
        await session.commit()


async def _subscribe_presence(client: SocketModeClient, user_ids: list[str]) -> None:
    """Subscribe to presence events in chunks of 500 (Slack limit)."""
    chunk_size = 500
    for i in range(0, len(user_ids), chunk_size):
        chunk = user_ids[i : i + chunk_size]
        await client.send_message(json.dumps({"type": "presence_sub", "ids": chunk}))
        await asyncio.sleep(0.1)


async def _get_all_active_user_ids() -> list[str]:
    async with async_session_factory() as session:
        result = await session.execute(
            select(SlackUser.slack_id).where(SlackUser.is_active == True)  # noqa: E712
        )
        return [row[0] for row in result.all()]


async def _process_event(client: SocketModeClient, req: SocketModeRequest) -> None:
    if req.envelope_id:
        await client.send_socket_mode_response(
            SocketModeResponse(envelope_id=req.envelope_id)
        )

    payload = req.payload
    if not isinstance(payload, dict):
        return
    event_type = payload.get("type")

    # events_api wraps the real event in an event_callback envelope
    if event_type == "event_callback":
        payload = payload.get("event", {})
        event_type = payload.get("type")

    if event_type == "presence_change":
        slack_id = payload.get("user")
        presence = payload.get("presence")  # 'active' | 'away'
        if slack_id and presence:
            await _upsert_presence_change(slack_id, presence, source="rtm")

    elif event_type == "user_change":
        user = payload.get("user", {})
        slack_id = user.get("id")
        if not slack_id:
            return
        profile = user.get("profile", {})
        status_text = profile.get("status_text", "") or ""
        status_emoji = profile.get("status_emoji", "") or ""
        is_busy = bool(
            profile.get("status_emoji") == ":bus:" or profile.get("huddle_state")
        )
        await _upsert_status_change(
            slack_id=slack_id,
            status_text=status_text,
            status_emoji=status_emoji,
            is_busy=is_busy,
            is_dnd=False,
        )

    elif event_type == "dnd_updated_user":
        slack_id = payload.get("user")
        dnd_status = payload.get("dnd_status", {})
        is_dnd = (
            dnd_status.get("dnd_enabled", False)
            and dnd_status.get("next_dnd_start_ts", 0) > 0
        )
        if slack_id:
            async with async_session_factory() as session:
                result = await session.execute(
                    select(SlackUser).where(SlackUser.slack_id == slack_id)
                )
                user_row = result.scalar_one_or_none()
                if user_row and user_row.is_dnd != is_dnd:
                    user_row.is_dnd = is_dnd
                    session.add(
                        StatusHistory(
                            slack_id=slack_id,
                            status_text=user_row.current_status_text,
                            status_emoji=user_row.current_status_emoji,
                            is_busy=user_row.is_busy,
                            is_dnd=is_dnd,
                        )
                    )
                    await session.commit()


async def start_rtm_monitor() -> None:
    """Start the Socket Mode client. Runs forever; reconnects automatically."""
    global _socket_client, rtm_connected

    web_client = AsyncWebClient(token=settings.slack_bot_token)
    client = SocketModeClient(app_token=settings.slack_app_token, web_client=web_client)
    _socket_client = client

    client.socket_mode_request_listeners.append(_process_event)

    try:
        await client.connect()
        rtm_connected = True
        logger.info("RTM Socket Mode client started")
        user_ids = await _get_all_active_user_ids()
        if user_ids:
            try:
                await _subscribe_presence(client, user_ids)
                logger.info("Subscribed to presence for %d users", len(user_ids))
            except Exception as e:
                logger.error("Presence subscription failed: %s", e)
        while True:
            await asyncio.sleep(60)
    except asyncio.CancelledError:
        rtm_connected = False
        await client.close()
        logger.info("RTM monitor stopped")


async def subscribe_new_users(user_ids: list[str]) -> None:
    """Called after a user sync to subscribe newly discovered users."""
    if _socket_client and rtm_connected and user_ids:
        await _subscribe_presence(_socket_client, user_ids)
