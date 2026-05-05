import json
import asyncio
from datetime import datetime
from typing import AsyncGenerator
import redis.asyncio as aioredis
from app.config import settings


def get_redis_client() -> aioredis.Redis:
    return aioredis.from_url(settings.redis_url, decode_responses=True)


def get_sync_redis_client():
    import redis
    return redis.from_url(settings.redis_url, decode_responses=True)


def channel_name(document_id: str) -> str:
    return f"doc:{document_id}:events"


def publish_event_sync(document_id: str, event: str, stage: str = None, message: str = None, progress: int = None):
    """Sync version used inside Celery workers."""
    client = get_sync_redis_client()
    payload = {
        "event": event,
        "document_id": document_id,
        "stage": stage,
        "message": message,
        "progress": progress,
        "timestamp": datetime.utcnow().isoformat(),
    }
    client.publish(channel_name(document_id), json.dumps(payload))
    client.setex(f"doc:{document_id}:status", 3600, json.dumps(payload))
    client.close()


async def event_stream(document_id: str) -> AsyncGenerator[str, None]:
    """Async generator that subscribes to Redis Pub/Sub and yields SSE lines."""
    client = get_redis_client()
    pubsub = client.pubsub()
    channel = channel_name(document_id)
    await pubsub.subscribe(channel)

    try:
        yield f"data: {json.dumps({'event': 'connected', 'document_id': document_id})}\n\n"

        async for message in pubsub.listen():
            if message["type"] == "message":
                data = message["data"]
                yield f"data: {data}\n\n"

                try:
                    parsed = json.loads(data)
                    if parsed.get("event") in ("job_completed", "job_failed", "job_cancelled"):
                        break
                except json.JSONDecodeError:
                    pass

            await asyncio.sleep(0)
    except asyncio.CancelledError:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
        await client.aclose()


async def get_latest_status(document_id: str) -> dict | None:
    """Polling fallback: get last known status from Redis."""
    client = get_redis_client()
    try:
        data = await client.get(f"doc:{document_id}:status")
        return json.loads(data) if data else None
    finally:
        await client.aclose()
