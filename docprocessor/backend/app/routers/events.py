from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.services.redis_service import event_stream, get_latest_status

router = APIRouter(prefix="/api/events", tags=["events"])

@router.get("/{document_id}")
async def stream_events(document_id: str):
    """

    Server-Sent Events endpoint.
    Subscribes to Redis Pub/Sub channel for the given document and streams events.
    """
    return StreamingResponse(
        event_stream(document_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep_alive",
            "X-Accel-Buffering": "no",
        },

    )

@router.get("/{document_id}/status")
async def get_status(document_id: str):
    """Polling fallback: returns the latest status from Redis."""
    status = await get_latest_status(document_id)
    return status or {"event":"unknown", "document_id": document_id}