import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text, Enum as SAEnum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum

from app.database import Base

class JobStatus(str, enum.Enum):
    pending = "pending"
    started = "started"
    completed = "completed"
    failed = "failed"
    revoked = "revoked"

class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    celery_task_id: Mapped[str] = mapped_column(String(255), nullable=True, unique=True)
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus), default=JobStatus.pending, nullable=False
    )
    current_stage: Mapped[str] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str] = mapped_column(Text, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    document: Mapped["Document"] = relationship(  # noqa: F821
        "Document", back_populates="jobs"
    )
