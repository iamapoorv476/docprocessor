import uuid
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict
from app.models.document import DocumentStatus


class DocumentBase(BaseModel):
    filename: str
    original_filename: str
    file_size: int
    mime_type: Optional[str] = None


class DocumentCreate(DocumentBase):
    file_path: str


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    original_filename: str
    file_size: int
    mime_type: Optional[str]
    status: DocumentStatus
    current_stage: Optional[str]
    finalized: bool
    extracted_data: Optional[dict[str, Any]]
    reviewed_data: Optional[dict[str, Any]]
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime


class DocumentListResponse(BaseModel):
    items: list[DocumentResponse]
    total: int
    page: int
    page_size: int


class ReviewUpdateRequest(BaseModel):
    reviewed_data: dict[str, Any]


class FinalizeRequest(BaseModel):
    pass


class ExportFormat(str):
    json = "json"
    csv = "csv"
