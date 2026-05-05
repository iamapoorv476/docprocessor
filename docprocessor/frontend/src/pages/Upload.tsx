import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadDocuments } from '../api/client'
import { useToast } from '../App'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Upload() {
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { show } = useToast()

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return
    const arr = Array.from(incoming)
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size))
      return [...prev, ...arr.filter(f => !existing.has(f.name + f.size))]
    })
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  const removeFile = (idx: number) => setFiles(f => f.filter((_, i) => i !== idx))

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    try {
      const docs = await uploadDocuments(files)
      show(`${docs.length} document${docs.length > 1 ? 's' : ''} queued for processing`, 'success')
      navigate('/')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      show(msg, 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="section-header">
        <h1 className="section-title">Upload documents</h1>
      </div>

      <div
        className={`upload-zone ${dragging ? 'dragging' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
      >
        <div className="upload-zone-icon">⬆</div>
        <div className="upload-zone-text">Drop files here or click to browse</div>
        <div className="upload-zone-sub">PDF · TXT · CSV · JSON · DOCX · XLSX · images · any file up to 100 MB</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={e => addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="card-title">Selected files ({files.length})</div>
          {files.map((f, i) => (
            <div key={i} className="file-item">
              <span style={{ fontSize: 18, opacity: 0.6 }}>📄</span>
              <span className="file-item-name">{f.name}</span>
              <span className="file-item-size">{formatSize(f.size)}</span>
              <button
                className="btn btn-sm btn-secondary"
                onClick={e => { e.stopPropagation(); removeFile(i) }}
                style={{ flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? <><span className="spinner" /> Uploading…</> : `Upload ${files.length} file${files.length > 1 ? 's' : ''}`}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setFiles([])}
              disabled={uploading}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 32 }}>
        <div className="card-title">How it works</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            ['01', 'Upload', 'Files are saved and a processing job is created immediately'],
            ['02', 'Queue', 'Each file enters the Celery worker queue — no waiting in request'],
            ['03', 'Process', 'Worker parses, extracts fields, and stores structured results'],
            ['04', 'Review', 'Edit extracted data, finalize, and export as JSON or CSV'],
          ].map(([num, title, desc]) => (
            <div key={num} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', paddingTop: 2, minWidth: 20 }}>{num}</span>
              <div>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>{title}</div>
                <div style={{ color: 'var(--text2)', fontSize: 12 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
