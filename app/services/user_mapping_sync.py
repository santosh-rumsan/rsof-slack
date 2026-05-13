"""Sync user ID ↔ Slack ID mappings from the external user management system."""

import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import settings
from app.database import async_session_factory
from app.models.slack_user import UserMapping

logger = logging.getLogger(__name__)


async def sync_user_mappings() -> dict:
    """Fetch the flat array of {id, slack_id, ...} from the user mgmt API
    and upsert into user_mappings."""
    if not settings.user_mgmt_api_url:
        logger.warning("USER_MGMT_API_URL not set; skipping user mapping sync")
        return {"synced": 0, "skipped": 0}

    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.get(
            settings.user_mgmt_api_url,
            headers={"Authorization": f"Bearer {settings.user_mgmt_api_key}"},
        )
        resp.raise_for_status()
        body = resp.json()
        data: list[dict] = body.get("data", body) if isinstance(body, dict) else body

    synced = 0
    skipped = 0
    now = datetime.now(timezone.utc)

    async with async_session_factory() as session:
        for item in data:
            internal_id = item.get("user_cuid")
            slack_id = item.get("external_id")
            if not internal_id or not slack_id:
                skipped += 1
                continue

            stmt = (
                pg_insert(UserMapping)
                .values(
                    id=str(internal_id),
                    slack_id=slack_id,
                    synced_at=now,
                )
                .on_conflict_do_update(
                    index_elements=["id"],
                    set_={"slack_id": slack_id, "synced_at": now},
                )
            )
            await session.execute(stmt)
            synced += 1

        await session.commit()

    logger.info("User mapping sync complete: %d synced, %d skipped", synced, skipped)
    return {"synced": synced, "skipped": skipped}
