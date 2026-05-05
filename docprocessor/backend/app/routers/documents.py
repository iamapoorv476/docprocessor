import uuid
from typing import Optional
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.document import Document, DocumentStatus
from app.models.job import ProcessingJob, JobStatus
from app.schemas.document import DocumentResponse, DocumentListResponse, ReviewUpdateRequest
from app.services.document_service import document_service
from app.services.storage_service import storage_service

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("/upload", response_model=list[DocumentResponse])
async def upload_documents(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload one or more documents. Creates a processing job per file."""
    from app.workers.tasks import process_document

    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    max_size = 100 * 1024 * 1024  # 100MB
    results = []

    for upload in files:
        if not upload.filename:
            continue

        # Save to storage
        filename, file_path, file_size = await storage_service.save_file(upload)

        if file_size > max_size:
            await storage_service.delete_file(file_path)
            raise HTTPException(status_code=413, detail=f"File {upload.filename} exceeds 100MB limit")

        mime_type = storage_service.detect_mime_type(file_path)

        # Create document record
        doc = Document(
            filename=filename,
            original_filename=upload.filename,
            file_path=file_path,
            file_size=file_size,
            mime_type=mime_type,
            status=DocumentStatus.queued,
        )
        db.add(doc)
        await db.flush()
        await db.refresh(doc)

        # Create job record
        job = ProcessingJob(
            document_id=doc.id,
            status=JobStatus.pending,
            attempt_count=1,
        )
        db.add(job)
        await db.flush()
        await db.refresh(job)

        # Enqueue Celery task — fire and forget
        task = process_document.delay(str(doc.id), str(job.id))
        job.celery_task_id = task.id
        await db.flush()

        results.append(DocumentResponse.model_validate(doc))

    if not results:
        raise HTTPException(status_code=400, detail="No valid files processed")

    return results


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await document_service.list_documents(
        db, search=search, status=status,
        sort_by=sort_by, sort_order=sort_order,
        page=page, page_size=page_size,
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str, db: AsyncSession = Depends(get_db)):
    return await document_service.get_document(db, document_id)


@router.put("/{document_id}/review", response_model=DocumentResponse)
async def update_review(
    document_id: str,
    body: ReviewUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    return await document_service.update_review(db, document_id, body.reviewed_data)


@router.post("/{document_id}/finalize", response_model=DocumentResponse)
async def finalize_document(document_id: str, db: AsyncSession = Depends(get_db)):
    return await document_service.finalize(db, document_id)


@router.post("/{document_id}/retry", response_model=DocumentResponse)
async def retry_document(document_id: str, db: AsyncSession = Depends(get_db)):
    return await document_service.retry_job(db, document_id)


@router.delete("/{document_id}", status_code=204)
async def delete_document(document_id: str, db: AsyncSession = Depends(get_db)):
    doc = await document_service.get_document(db, document_id)
    await storage_service.delete_file(doc.file_path)
    await db.delete(doc)


@router.get("/{document_id}/export")
async def export_document(
    document_id: str,
    format: str = Query("json", pattern="^(json|csv)$"),
    db: AsyncSession = Depends(get_db),
):
    content, media_type = await document_service.export_document(db, document_id, format)
    doc = await document_service.get_document(db, document_id)
    safe_name = doc.original_filename.replace(" ", "_")
    ext = "json" if format == "json" else "csv"
    filename = f"{safe_name}_export.{ext}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
