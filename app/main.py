"""FastAPI application entry point."""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import admin, health, me
from app.services import slack_sync, user_mapping_sync
from app.services.slack_monitor import start_rtm_monitor

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()
admin.set_scheduler(scheduler)

_rtm_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _rtm_task

    # Run Alembic migrations on startup
    _run_migrations()

    # Initial data sync
    try:
        await slack_sync.sync_slack_users()
    except Exception as e:
        logger.warning("Initial user sync failed: %s", e)

    try:
        await user_mapping_sync.sync_user_mappings()
    except Exception as e:
        logger.warning("Initial user mapping sync failed: %s", e)

    # Start RTM monitor in background
    _rtm_task = asyncio.create_task(start_rtm_monitor())

    # Schedule periodic jobs
    scheduler.add_job(
        slack_sync.sync_slack_users,
        "interval",
        minutes=settings.user_sync_interval,
        id="user_sync",
        replace_existing=True,
    )
    scheduler.add_job(
        slack_sync.reconcile_presence,
        "interval",
        minutes=settings.presence_reconcile_interval,
        id="presence_reconcile",
        replace_existing=True,
    )
    scheduler.add_job(
        user_mapping_sync.sync_user_mappings,
        "interval",
        minutes=settings.user_mapping_sync_interval,
        id="user_mapping_sync",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started with %d jobs", len(scheduler.get_jobs()))

    yield

    # Shutdown
    scheduler.shutdown(wait=False)
    if _rtm_task:
        _rtm_task.cancel()
        try:
            await _rtm_task
        except asyncio.CancelledError:
            pass


def _run_migrations() -> None:
    """Run Alembic migrations synchronously at startup."""
    try:
        from alembic import command
        from alembic.config import Config

        alembic_cfg = Config("alembic.ini")
        # Override URL to use sync driver
        sync_url = settings.database_url.replace(
            "postgresql+asyncpg://", "postgresql://"
        )
        alembic_cfg.set_main_option("sqlalchemy.url", sync_url)
        command.upgrade(alembic_cfg, "head")
        logger.info("Database migrations applied")
    except Exception as e:
        logger.error("Migration failed: %s", e)
        raise


def create_app() -> FastAPI:
    app = FastAPI(
        title="rsof-slack",
        description="Slack presence and status monitoring API",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix="/api/v1", tags=["health"])
    app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
    app.include_router(me.router, prefix="/api/v1", tags=["me"])

    # Serve frontend static files (production build)
    dist = settings.frontend_dist
    if os.path.isdir(dist):
        app.mount("/assets", StaticFiles(directory=f"{dist}/assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str):
            index = os.path.join(dist, "index.html")
            return FileResponse(index)

    return app


app = create_app()


def start_dev() -> None:
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.app_port,
        reload=True,
        log_level=settings.log_level,
    )


def start_prod() -> None:
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.app_port,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    start_prod()
