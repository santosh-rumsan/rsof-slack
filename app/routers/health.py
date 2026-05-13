from fastapi import APIRouter

from app.services import slack_monitor

router = APIRouter()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "rtm": "connected" if slack_monitor.rtm_connected else "disconnected",
    }
