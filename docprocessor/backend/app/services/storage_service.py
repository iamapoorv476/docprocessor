import os
import uuid
import aiofiles
from pathlib import Path
from fastapi import UploadFile
from app.config import settings


class StorageService:
    """
    Abstracts file I/O. Currently uses local disk.
    Swap save_file / delete_file / get_file_path for S3/GCS without touching the rest.
    """

    def __init__(self, base_dir: str = None):
        self.base_dir = Path(base_dir or settings.upload_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _generate_path(self, original_filename: str) -> tuple[str, str]:
        ext = Path(original_filename).suffix.lower()
        unique_name = f"{uuid.uuid4().hex}{ext}"
        return unique_name, str(self.base_dir / unique_name)

    async def save_file(self, upload: UploadFile) -> tuple[str, str, int]:
        """
        Save uploaded file to disk.
        Returns (filename, file_path, file_size).
        """
        filename, file_path = self._generate_path(upload.filename)
        size = 0
        async with aiofiles.open(file_path, "wb") as f:
            while chunk := await upload.read(1024 * 1024):  # 1MB chunks
                await f.write(chunk)
                size += len(chunk)
        return filename, file_path, size

    async def delete_file(self, file_path: str) -> bool:
        try:
            os.remove(file_path)
            return True
        except FileNotFoundError:
            return False

    def get_file_path(self, filename: str) -> str:
        return str(self.base_dir / filename)

    def file_exists(self, file_path: str) -> bool:
        return Path(file_path).exists()

    def read_file_bytes(self, file_path: str) -> bytes:
        with open(file_path, "rb") as f:
            return f.read()

    def detect_mime_type(self, file_path: str) -> str:
        """Basic MIME detection from extension (no libmagic dependency needed)."""
        ext = Path(file_path).suffix.lower()
        mime_map = {
            ".pdf": "application/pdf",
            ".txt": "text/plain",
            ".csv": "text/csv",
            ".json": "application/json",
            ".xml": "application/xml",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".html": "text/html",
            ".md": "text/markdown",
        }
        return mime_map.get(ext, "application/octet-stream")


storage_service = StorageService()
