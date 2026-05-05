import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict
from app.models.job import JobStatus


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    celery_task_id: Optional[str]
    status: JobStatus
    current_stage: Optional[str]
    error_message: Optional[str]
    attempt_count: int
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


class ProgressEvent(BaseModel):
    event: str
    document_id: str
    stage: Optional[str] = None
    message: Optional[str] = None
    progress: Optional[int] = None
    timestamp: datetime = None

    def __init__(self, **data):
        if data.get("timestamp") is None:
            data["timestamp"] = datetime.utcnow()
        super().__init__(**data)
