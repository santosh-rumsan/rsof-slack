"""Slack user sync and presence reconciliation."""

import asyncio
import logging
from datetime import datetime, timezone

from slack_sdk.web.async_client import AsyncWebClient
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import settings
from app.database import async_session_factory
from app.models.slack_user import SlackUser
from app.services.slack_monitor import subscribe_new_users, _upsert_presence_change

logger = logging.getLogger(__name__)

_web_client: AsyncWebClient | None = None


def get_web_client() -> AsyncWebClient:
    global _web_client
    if _web_client is None:
        _web_client = AsyncWebClient(token=settings.slack_bot_token)
    return _web_client


async def sync_slack_users() -> dict:
    """Fetch all users from Slack and upsert into slack_users table.
    Returns stats dict."""
    client = get_web_client()
    all_users = []
    cursor = None

    while True:
        resp = await client.users_list(limit=200, cursor=cursor)
        members = resp.get("members", [])
        all_users.extend(members)
        cursor = resp.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break
        await asyncio.sleep(0.5)

    # Filter out bots and slackbot
    real_users = [
        u for u in all_users if not u.get("is_bot") and u.get("id") != "USLACKBOT"
    ]
    slack_ids_from_api = {u["id"] for u in real_users}

    upserted = 0
    deactivated = 0
    new_ids = []

    async with async_session_factory() as session:
        # Existing user IDs in DB
        result = await session.execute(select(SlackUser.slack_id, SlackUser.is_active))
        existing = {row[0]: row[1] for row in result.all()}

        for user in real_users:
            profile = user.get("profile", {})
            slack_id = user["id"]
            is_deleted = user.get("deleted", False)

            stmt = (
                pg_insert(SlackUser)
                .values(
                    slack_id=slack_id,
                    real_name=user.get("real_name") or profile.get("real_name"),
                    display_name=profile.get("display_name") or user.get("name"),
                    email=profile.get("email"),
                    avatar_url=profile.get("image_72"),
                    is_active=not is_deleted,
                    updated_at=datetime.now(timezone.utc),
                )
                .on_conflict_do_update(
                    index_elements=["slack_id"],
                    set_={
                        "real_name": pg_insert(SlackUser).excluded.real_name,
                        "display_name": pg_insert(SlackUser).excluded.display_name,
                        "email": pg_insert(SlackUser).excluded.email,
                        "avatar_url": pg_insert(SlackUser).excluded.avatar_url,
                        "is_active": pg_insert(SlackUser).excluded.is_active,
                        "updated_at": pg_insert(SlackUser).excluded.updated_at,
                    },
                )
            )
            await session.execute(stmt)
            upserted += 1

            if slack_id not in existing:
                new_ids.append(slack_id)

        # Mark users no longer in Slack as inactive
        for slack_id, was_active in existing.items():
            if slack_id not in slack_ids_from_api and was_active:
                result2 = await session.execute(
                    select(SlackUser).where(SlackUser.slack_id == slack_id)
                )
                u = result2.scalar_one_or_none()
                if u:
                    u.is_active = False
                    deactivated += 1

        await session.commit()

    # Subscribe newly found users to RTM presence events
    if new_ids:
        await subscribe_new_users(new_ids)

    stats = {"upserted": upserted, "deactivated": deactivated, "new": len(new_ids)}
    logger.info("User sync complete: %s", stats)
    return stats


async def reconcile_presence() -> dict:
    """Poll presence for all active users and update DB only if changed."""
    client = get_web_client()

    async with async_session_factory() as session:
        result = await session.execute(
            select(SlackUser.slack_id, SlackUser.current_presence).where(
                SlackUser.is_active == True
            )  # noqa: E712
        )
        users = result.all()

    updated = 0
    for slack_id, current_presence in users:
        try:
            resp = await client.users_getPresence(user=slack_id)
            presence = resp.get("presence")  # 'active' | 'away'
            if presence and presence != current_presence:
                changed = await _upsert_presence_change(slack_id, presence, source="poll")
                if changed:
                    updated += 1
        except Exception as e:
            logger.warning("Failed to fetch presence for %s: %s", slack_id, e)

        await asyncio.sleep(0.1)  # 100ms between calls — Slack Tier 3 rate limit

    logger.info(
        "Presence reconciliation complete: %d updated out of %d users",
        updated,
        len(users),
    )
    return {"checked": len(users), "updated": updated}
