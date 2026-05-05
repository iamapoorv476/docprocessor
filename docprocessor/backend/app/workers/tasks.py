import uuid
import time
import json
import re
from datetime import datetime
from pathlib import Path
from celery import Task
from celery.utils.log import get_task_logger

from app.workers.celery_app import celery_app
from app.services.redis_service import publish_event_sync
from app.config import settings

logger = get_task_logger(__name__)

def get_db_session():
    """Synchronous DB session for use inside Celery tasks."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(settings.sync_database_url, pool_pre_ping=True)
    Session = sessionmaker(bind=engine)
    return Session(), engine


def emit(document_id: str, event: str, stage: str, message: str, progress: int):
    publish_event_sync(document_id, event, stage=stage, message=message, progress=progress)
    logger.info(f"[{document_id}] {event}: {message} ({progress}%)")


CATEGORY_MAP = {
    "invoice": "Finance",
    "receipt": "Finance",
    "report": "Reports",
    "summary": "Reports",
    "contract": "Legal",
    "agreement": "Legal",
    "policy": "Legal",
    "image": "Media",
    "photo": "Media",
    "cv": "HR",
    "resume": "HR",
    "data": "Data",
    "log": "Technical",
    "config": "Technical",
    "readme": "Documentation",
    "spec": "Documentation",
    "manual": "Documentation",
}

STOPWORDS = {"the", "a", "an", "is", "in", "of", "to", "and", "or", "for", "with", "on", "at"}


def classify_document(filename: str, mime_type: str) -> str:
    lower = filename.lower()
    for keyword, category in CATEGORY_MAP.items():
        if keyword in lower:
            return category
    if mime_type:
        if "pdf" in mime_type:
            return "PDF Document"
        if "image" in mime_type:
            return "Media"
        if "spreadsheet" in mime_type or "csv" in mime_type:
            return "Data"
        if "text" in mime_type:
            return "Text Document"
    return "General"


def extract_keywords(filename: str, file_content_preview: str = "") -> list[str]:
    text = (filename + " " + file_content_preview).lower()
    words = re.findall(r"[a-z]{4,}", text)
    filtered = [w for w in words if w not in STOPWORDS]
    freq = {}
    for w in filtered:
        freq[w] = freq.get(w, 0) + 1
    sorted_words = sorted(freq, key=freq.get, reverse=True)
    return sorted_words[:10]


def generate_summary(filename: str, size: int, mime_type: str) -> str:
    size_desc = (
        f"{size} bytes" if size < 1024
        else f"{size // 1024} KB" if size < 1024 * 1024
        else f"{size // (1024 * 1024)} MB"
    )
    return (
        f"Document '{filename}' ({size_desc}, {mime_type or 'unknown type'}) "
        f"uploaded for processing. Metadata extracted and fields identified."
    )


def read_text_preview(file_path: str, max_bytes: int = 2048) -> str:
    try:
        with open(file_path, "rb") as f:
            raw = f.read(max_bytes)
        return raw.decode("utf-8", errors="ignore")
    except Exception:
        return ""


@celery_app.task(
    bind=True,
    name="app.workers.tasks.process_document",
    max_retries=3,
    default_retry_delay=10,
    soft_time_limit=120,
    time_limit=180,
)
def process_document(self: Task, document_id: str, job_id: str):
    session, engine = get_db_session()
    try:
        from app.models.document import Document, DocumentStatus
        from app.models.job import ProcessingJob, JobStatus

        doc = session.get(Document, uuid.UUID(document_id))
        job = session.get(ProcessingJob, uuid.UUID(job_id))

        if not doc or not job:
            logger.error(f"Document or job not found: {document_id}/{job_id}")
            return

        doc.status = DocumentStatus.processing
        doc.current_stage = "job_started"
        job.status = JobStatus.started
        job.started_at = datetime.utcnow()
        job.current_stage = "job_started"
        session.commit()

        emit(document_id, "job_started", "job_started", "Processing job started", 5)
        time.sleep(0.5)

        emit(document_id, "document_parsing_started", "parsing", "Parsing document structure", 15)
        doc.current_stage = "parsing"
        job.current_stage = "parsing"
        session.commit()
        time.sleep(1.0)

        file_path = doc.file_path
        file_size = doc.file_size
        mime_type = doc.mime_type or "application/octet-stream"
        original_filename = doc.original_filename

        preview = read_text_preview(file_path) if Path(file_path).exists() else ""

        emit(document_id, "document_parsing_completed", "parsing", "Document parsed successfully", 35)
        time.sleep(0.5)

        emit(document_id, "field_extraction_started", "extraction", "Extracting structured fields", 45)
        doc.current_stage = "extraction"
        job.current_stage = "extraction"
        session.commit()
        time.sleep(1.2)

        category = classify_document(original_filename, mime_type)
        keywords = extract_keywords(original_filename, preview)
        title = Path(original_filename).stem.replace("-", " ").replace("_", " ").title()
        summary = generate_summary(original_filename, file_size, mime_type)

        extracted = {
            "title": title,
            "category": category,
            "summary": summary,
            "keywords": keywords,
            "file_metadata": {
                "original_filename": original_filename,
                "file_size_bytes": file_size,
                "mime_type": mime_type,
                "extension": Path(original_filename).suffix.lower(),
            },
            "content_preview": preview[:500] if preview else None,
            "word_count": len(preview.split()) if preview else 0,
            "processing_metadata": {
                "processed_at": datetime.utcnow().isoformat(),
                "worker_task_id": self.request.id,
                "attempt": job.attempt_count,
            },
        }

        emit(document_id, "field_extraction_completed", "extraction", "Fields extracted successfully", 70)
        time.sleep(0.5)

        emit(document_id, "result_storing", "storing", "Persisting final result", 85)
        doc.current_stage = "storing"
        job.current_stage = "storing"
        session.commit()
        time.sleep(0.5)

        doc.extracted_data = extracted
        doc.status = DocumentStatus.completed
        doc.current_stage = "completed"
        doc.error_message = None
        job.status = JobStatus.completed
        job.current_stage = "completed"
        job.completed_at = datetime.utcnow()
        session.commit()

        emit(document_id, "job_completed", "completed", "Document processing complete", 100)
        logger.info(f"Document {document_id} processed successfully")

    except Exception as exc:
        logger.exception(f"Processing failed for document {document_id}: {exc}")
        try:
            from app.models.document import Document, DocumentStatus
            from app.models.job import ProcessingJob, JobStatus

            doc = session.get(Document, uuid.UUID(document_id))
            job = session.get(ProcessingJob, uuid.UUID(job_id))
            if doc:
                doc.status = DocumentStatus.failed
                doc.error_message = str(exc)
            if job:
                job.status = JobStatus.failed
                job.error_message = str(exc)
                job.completed_at = datetime.utcnow()
            session.commit()
        except Exception as inner:
            logger.exception(f"Failed to update error state: {inner}")

        emit(document_id, "job_failed", "failed", f"Processing failed: {exc}", 0)
        raise exc

    finally:
        session.close()
        engine.dispose()
