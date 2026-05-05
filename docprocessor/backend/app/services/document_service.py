import uuid
import csv
import json
import io
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, desc, asc
from fastapi import HTTPException

from app.models.document import Document, DocumentStatus
from app.models.job import ProcessingJob, JobStatus
from app.schemas.document import DocumentListResponse, DocumentResponse


class DocumentService:

    async def get_document(self, db: AsyncSession, document_id: str) -> Document:
        result = await db.execute(
            select(Document).where(Document.id == uuid.UUID(document_id))
        )
        doc = result.scalar_one_or_none()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        return doc

    async def list_documents(
        self,
        db: AsyncSession,
        search: Optional[str] = None,
        status: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        page: int = 1,
        page_size: int = 20,
    ) -> DocumentListResponse:
        query = select(Document)

        if search:
            query = query.where(
                or_(
                    Document.original_filename.ilike(f"%{search}%"),
                    Document.filename.ilike(f"%{search}%"),
                )
            )

        if status and status != "all":
            try:
                status_enum = DocumentStatus(status)
                query = query.where(Document.status == status_enum)
            except ValueError:
                pass

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()

        sort_col = getattr(Document, sort_by, Document.created_at)
        order_fn = desc if sort_order == "desc" else asc
        query = query.order_by(order_fn(sort_col))
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await db.execute(query)
        docs = result.scalars().all()

        return DocumentListResponse(
            items=[DocumentResponse.model_validate(d) for d in docs],
            total=total,
            page=page,
            page_size=page_size,
        )

    async def update_review(self, db: AsyncSession, document_id: str, reviewed_data: dict) -> Document:
        doc = await self.get_document(db, document_id)
        if doc.finalized:
            raise HTTPException(status_code=400, detail="Document is finalized and cannot be edited")
        doc.reviewed_data = reviewed_data
        await db.flush()
        await db.refresh(doc)
        return doc

    async def finalize(self, db: AsyncSession, document_id: str) -> Document:
        doc = await self.get_document(db, document_id)
        if doc.status != DocumentStatus.completed:
            raise HTTPException(status_code=400, detail="Only completed documents can be finalized")
        if doc.finalized:
            raise HTTPException(status_code=400, detail="Document is already finalized")
        doc.finalized = True
        await db.flush()
        await db.refresh(doc)
        return doc

    async def retry_job(self, db: AsyncSession, document_id: str):
        from app.workers.tasks import process_document

        doc = await self.get_document(db, document_id)
        if doc.status not in (DocumentStatus.failed, DocumentStatus.cancelled):
            raise HTTPException(status_code=400, detail="Only failed or cancelled jobs can be retried")

        # Count existing attempts
        result = await db.execute(
            select(func.count()).where(ProcessingJob.document_id == doc.id)
        )
        attempt_count = result.scalar_one() + 1

        if attempt_count > 3:
            raise HTTPException(status_code=400, detail="Maximum retry attempts (3) reached")

        # Check no active job already queued (idempotency)
        active = await db.execute(
            select(ProcessingJob).where(
                ProcessingJob.document_id == doc.id,
                ProcessingJob.status.in_([JobStatus.pending, JobStatus.started]),
            )
        )
        if active.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="A job is already active for this document")

        # Reset document status
        doc.status = DocumentStatus.queued
        doc.error_message = None
        doc.current_stage = None

        # Create new job record
        new_job = ProcessingJob(
            document_id=doc.id,
            status=JobStatus.pending,
            attempt_count=attempt_count,
        )
        db.add(new_job)
        await db.flush()

        # Enqueue Celery task
        task = process_document.delay(str(doc.id), str(new_job.id))
        new_job.celery_task_id = task.id
        await db.flush()
        await db.refresh(doc)
        return doc

    async def export_document(self, db: AsyncSession, document_id: str, fmt: str) -> tuple[str, str]:
        doc = await self.get_document(db, document_id)
        if not doc.finalized and doc.status != DocumentStatus.completed:
            raise HTTPException(status_code=400, detail="Document must be completed before export")

        data = doc.reviewed_data or doc.extracted_data or {}

        if fmt == "json":
            content = json.dumps(
                {"document_id": str(doc.id), "filename": doc.original_filename, **data},
                indent=2,
                default=str,
            )
            return content, "application/json"
        elif fmt == "csv":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["field", "value"])
            writer.writerow(["document_id", str(doc.id)])
            writer.writerow(["filename", doc.original_filename])
            writer.writerow(["status", doc.status.value])
            writer.writerow(["finalized", doc.finalized])
            for k, v in data.items():
                if isinstance(v, (list, dict)):
                    v = json.dumps(v)
                writer.writerow([k, v])
            return output.getvalue(), "text/csv"
        else:
            raise HTTPException(status_code=400, detail="Format must be json or csv")


document_service = DocumentService()
