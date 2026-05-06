# DocProcessor

A production-style async document processing pipeline. Upload files, track processing in real time via Server-Sent Events (backed by Redis Pub/Sub), review and edit extracted structured output, finalize records, and export as JSON or CSV.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│  React + TypeScript frontend (Vite, port 5173)          │
│  Upload · Dashboard · Detail/Edit · Export              │
└───────────────┬──────────────────────────┬──────────────┘
                │ REST API                 │ SSE stream
                ▼                         ▼
┌─────────────────────────────────────────────────────────┐
│  FastAPI (Python 3.11, port 8000)                       │
│  Routers → Services → Schemas                           │
│  /api/documents  /api/events/{id}                       │
└────────┬─────────────────────────┬──────────────────────┘
         │ .delay() (fire+forget)  │ aioredis subscribe
         ▼                         ▼
┌──────────────────┐    ┌──────────────────────────────┐
│  Celery worker   │───▶│  Redis 7                     │
│  process_document│    │  Broker (db 0) · Pub/Sub     │
│  multi-stage     │    │  Result backend (db 1)       │
└──────────┬───────┘    └──────────────────────────────┘
           │ write results
           ▼
┌──────────────────────────────┐
│  PostgreSQL 16               │
│  documents · processing_jobs │
└──────────────────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  File storage (local disk)   │
│  Abstracted via StorageService│
│  → swap to S3 without changes│
└──────────────────────────────┘
```

### Key design decisions

- **Async boundary is strict**: the upload endpoint calls `process_document.delay()` and returns immediately. No blocking in request handlers.
- **Redis Pub/Sub for progress**: the Celery worker calls `redis.publish()` at each stage. FastAPI SSE endpoint subscribes via `aioredis` and streams events to the browser.
- **SSE over WebSocket**: simpler to implement and proxy, no stateful connection management required.
- **StorageService abstraction**: all file I/O goes through `StorageService`. Swap local disk for S3 by overriding `save_file` / `delete_file` without touching any other layer.
- **Sync SQLAlchemy in Celery**: Celery workers run synchronously; they use `psycopg2` + sync SQLAlchemy. The FastAPI layer uses `asyncpg` + async SQLAlchemy separately.
- **Idempotent retry**: before enqueuing a retry, the service checks for any active job for the document. Max 3 attempts enforced at the service layer.

---

## Processing stages

Each uploaded document goes through:

| Stage | Event published | Progress |
|-------|----------------|----------|
| Job created | `job_started` | 5% |
| Parsing document | `document_parsing_started` | 15% |
| Parsing done | `document_parsing_completed` | 35% |
| Field extraction | `field_extraction_started` | 45% |
| Extraction done | `field_extraction_completed` | 70% |
| Storing result | `result_storing` | 85% |
| Complete | `job_completed` | 100% |
| Failure | `job_failed` | — |

Extracted fields per document:
- `title` — derived from filename
- `category` — classified from filename keywords
- `summary` — human-readable description
- `keywords` — top 10 words from filename + content
- `file_metadata` — size, MIME type, extension
- `content_preview` — first 500 chars of text files
- `word_count`
- `processing_metadata` — timestamp, task ID, attempt

---

## Setup — Docker (recommended)

### Prerequisites
- Docker ≥ 24
- Docker Compose v2

```bash
git clone <repo>
cd docprocessor
docker compose up --build
```

Services start in order (postgres → redis → backend → worker → frontend).

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| API docs | http://localhost:8000/docs |
| API health | http://localhost:8000/health |

---

## Setup — local (without Docker)

### Requirements
- Python 3.11+
- Node 20+
- PostgreSQL 16 running locally
- Redis 7 running locally

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Create a .env file:
cat > .env << EOF
DATABASE_URL=postgresql+asyncpg://your_user:your_pass@localhost:5432/docprocessor
SYNC_DATABASE_URL=postgresql://your_user:your_pass@localhost:5432/docprocessor
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/1
UPLOAD_DIR=./uploads
EOF

# Create DB
createdb docprocessor

# Start FastAPI (tables created on startup)
uvicorn app.main:app --reload --port 8000
```

### Celery worker (separate terminal)

```bash
cd backend
source .venv/bin/activate
celery -A app.workers.celery_app worker --loglevel=info
```

### Frontend

```bash
cd frontend
npm install

# Create .env.local
echo "VITE_API_URL=http://localhost:8000" > .env.local

npm run dev
```

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/documents/upload` | Upload 1+ files (multipart) |
| GET | `/api/documents` | List with `?search=`, `?status=`, `?sort_by=`, `?sort_order=`, `?page=` |
| GET | `/api/documents/{id}` | Document detail |
| PUT | `/api/documents/{id}/review` | Save reviewed data edits |
| POST | `/api/documents/{id}/finalize` | Lock record |
| POST | `/api/documents/{id}/retry` | Re-queue failed job |
| DELETE | `/api/documents/{id}` | Delete document + file |
| GET | `/api/documents/{id}/export?format=json\|csv` | Export |
| GET | `/api/events/{id}` | SSE stream for live progress |
| GET | `/api/events/{id}/status` | Polling fallback |

Full interactive docs at http://localhost:8000/docs.

---

## Testing the flow

Sample files are in `sample-files/`:

```bash
# Upload via curl
curl -X POST http://localhost:8000/api/documents/upload \
  -F "files=@sample-files/invoice_q1_2024.txt" \
  -F "files=@sample-files/employee_data.csv"

# Check status
curl http://localhost:8000/api/documents | python -m json.tool

# Stream events (replace ID)
curl -N http://localhost:8000/api/events/<document-id>
```

---

## Assumptions and tradeoffs

### Assumptions
- Single-region deployment; no distributed file storage needed for MVP
- Text preview extraction works on UTF-8 files; binary files get metadata-only extraction
- No authentication required per spec; JWT middleware is straightforward to add
- Processing logic is simulated (no OCR/AI) but the async architecture is real

### Tradeoffs
- **SSE vs WebSocket**: SSE chosen for simplicity — one-directional, HTTP/1.1 compatible, no handshake. WebSocket would be needed for bidirectional real-time features.
- **Sync Celery + Async FastAPI**: two separate DB connection pools. This is the standard pattern — mixing asyncio into Celery tasks adds complexity without benefit since tasks are CPU-bound anyway.
- **Local file storage**: production would use S3/GCS. The `StorageService` abstraction means this is a one-file change.
- **No distributed locking**: retry idempotency is handled by checking DB state. With multiple API replicas a Redis lock (`setnx`) would be cleaner.

### Limitations
- No authentication (straightforward to add with FastAPI-Users or JWT)
- File content extraction is basic (no OCR, no PDF parsing)
- No cancellation signal sent to running Celery tasks (only DB status update)
- SSE connections are not persisted across page reloads; historical events are re-fetched from DB

---

## Project structure

```
docprocessor/
├── docker-compose.yml
├── README.md
├── sample-files/          # Test documents
├── sample-exports/        # Example exported outputs
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py        # FastAPI app + lifespan
│       ├── config.py      # pydantic-settings
│       ├── database.py    # async SQLAlchemy engine
│       ├── models/        # ORM models (Document, ProcessingJob)
│       ├── schemas/       # Pydantic DTOs
│       ├── routers/       # HTTP route handlers
│       ├── services/      # Business logic layer
│       └── workers/       # Celery app + tasks
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx        # Router + ToastProvider + Header
        ├── api/           # axios client
        ├── hooks/         # useJobEvents (SSE)
        ├── types/         # TypeScript interfaces
        ├── components/    # StatusBadge, ProgressBar
        └── pages/         # Upload, Dashboard, DocumentDetail
```

---

## Bonus features implemented

- [x] Docker Compose with all 5 services and health checks
- [x] File storage abstraction (StorageService — swap to S3 in one file)
- [x] Idempotent retry handling (DB state check + attempt cap)
- [x] Large file support (streaming 1MB chunk upload, 100MB limit)
- [x] Clean deployment-ready structure (separate API / worker images)
- [x] Polling fallback endpoint alongside SSE

## AI tools disclosure

This codebase was independently developed with Claude (Anthropic) used for occasional debugging support and minor implementation assistance.
