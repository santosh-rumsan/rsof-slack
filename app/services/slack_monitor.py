"""Slack RTM monitor using legacy RTM WebSocket API (bot token only).

Connects via rtm.connect, subscribes all active users to presence events,
and writes changes to the database.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

import aiohttp
from slack_sdk.web.async_client import AsyncWebClient
from sqlalchemy import select

from app.config import settings
from app.database import async_session_factory
from app.models.slack_user import PresenceHistory, SlackUser, StatusHistory

logger = logging.getLogger(__name__)

PRESENCE_SUBSCRIBE_CHUNK = 500

# Shared state accessible from routers
rtm_connected: bool = False
_ws: aiohttp.ClientWebSocketResponse | None = None

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
            return False

        old_presence = user.current_presence
        user.current_presence = presence
        user.last_presence_update = datetime.now(timezone.utc)
        session.add(
            PresenceHistory(slack_id=slack_id, presence=presence, source=source)
        )
        await session.commit()
        logger.info(
            "Presence change: %s (%s) %s → %s [%s]",
            user.display_name or user.real_name or slack_id,
            slack_id,
            old_presence or "unknown",
            presence,
            source,
        )
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


async def _get_all_active_user_ids() -> list[str]:
    async with async_session_factory() as session:
        result = await session.execute(
            select(SlackUser.slack_id).where(SlackUser.is_active == True)  # noqa: E712
        )
        return [row[0] for row in result.all()]


async def _subscribe_presence(
    ws: aiohttp.ClientWebSocketResponse, user_ids: list[str]
) -> None:
    """Subscribe to presence events in chunks of 500 (Slack RTM limit)."""
    for i in range(0, len(user_ids), PRESENCE_SUBSCRIBE_CHUNK):
        chunk = user_ids[i : i + PRESENCE_SUBSCRIBE_CHUNK]
        await ws.send_json({"type": "presence_sub", "ids": chunk})
        await asyncio.sleep(0.1)


async def _handle_event(payload: dict) -> None:
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
        is_busy = bool(profile.get("huddle_state"))
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


async def _run_rtm_session(web_client: AsyncWebClient) -> None:
    """Connect to RTM WebSocket, subscribe to presence, and handle events.
    Returns when the connection drops."""
    global rtm_connected, _ws

    print("[RTM] calling rtm_connect...", flush=True)
    resp = await web_client.rtm_connect()
    ws_url = resp["url"]
    print(f"[RTM] got WS URL, connecting...", flush=True)

    async with aiohttp.ClientSession() as http_session:
        async with http_session.ws_connect(ws_url) as ws:
            _ws = ws
            rtm_connected = True
            print("[RTM] WebSocket connected", flush=True)
            logger.info("RTM WebSocket connected")

            user_ids = await _get_all_active_user_ids()
            if user_ids:
                try:
                    await _subscribe_presence(ws, user_ids)
                    logger.info("Subscribed to presence for %d users", len(user_ids))
                except Exception as e:
                    logger.error("Presence subscription failed: %s", e)

            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    payload = json.loads(msg.data)
                    msg_type = payload.get("type")

                    if msg_type == "ping":
                        await ws.send_json(
                            {"type": "pong", "reply_to": payload.get("id", 0)}
                        )
                    elif msg_type == "hello":
                        logger.info("RTM hello received — connection live")
                    elif msg_type in ("presence_change", "user_change", "dnd_updated_user"):
                        logger.info("RTM event: %s", msg.data)
                        await _handle_event(payload)
                    else:
                        logger.debug("RTM event (ignored): type=%s", msg_type)
                        await _handle_event(payload)

                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    break

    rtm_connected = False
    _ws = None


async def start_rtm_monitor() -> None:
    """Start RTM monitor. Reconnects automatically with exponential backoff."""
    global rtm_connected

    print("[RTM] monitor task started", flush=True)
    logger.info("RTM monitor task started")

    web_client = AsyncWebClient(token=settings.slack_bot_token)
    delay = 5

    while True:
        try:
            await _run_rtm_session(web_client)
            print(f"[RTM] disconnected, reconnecting in {delay}s", flush=True)
            logger.warning("RTM disconnected, reconnecting in %ds", delay)
        except asyncio.CancelledError:
            rtm_connected = False
            print("[RTM] monitor stopped", flush=True)
            logger.info("RTM monitor stopped")
            return
        except Exception as e:
            print(f"[RTM] error: {e!r}, reconnecting in {delay}s", flush=True)
            logger.error("RTM error: %r, reconnecting in %ds", e, delay)
            rtm_connected = False

        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            rtm_connected = False
            print("[RTM] monitor stopped", flush=True)
            logger.info("RTM monitor stopped")
            return

        delay = min(delay * 2, 60)


async def subscribe_new_users(user_ids: list[str]) -> None:
    """Called after a user sync to subscribe newly discovered users."""
    if _ws and rtm_connected and user_ids:
        await _subscribe_presence(_ws, user_ids)
