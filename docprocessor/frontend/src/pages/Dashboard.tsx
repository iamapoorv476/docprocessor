import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDocuments, deleteDocument } from '../api/client'
import type { Document, DocumentListResponse, SortField, SortOrder } from '../types'
import StatusBadge from '../components/StatusBadge'
import ProgressBar from '../components/ProgressBar'
import { useToast } from '../App'
import { format } from 'date-fns'

function formatSize(bytes: number){
    if(bytes < 1024) return `${bytes} B`
    if(bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_OPTIONS = ['all', 'queued', 'processing', 'completed', 'failed', 'cancelled']
const SORT_FIELDS: { label: string; value: SortField }[] = [
  { label: 'Date', value: 'created_at' },
  { label: 'Name', value: 'original_filename' },
  { label: 'Size', value: 'file_size' },
  { label: 'Status', value: 'status' },
]

function LiveRow({doc, onRefresh}: {doc: Document; onRefresh: () => void}) {
    const navigate = useNavigate()
    const {show} = useToast()
    const [progress, setProgress] = useState<number | null>(null)
    const [liveStatus, setLiveStatus] = useState(doc.status)
    const [liveStage, setLiveStage] = useState(doc.current_stage)
    const esRef = useRef<EventSource | null>(null)
    const BASE = import.meta.env.VITE_API_URL || ''

    useEffect(() => {
        setLiveStatus(doc.status)
        setLiveStage(doc.current_stage)

    }, [doc.status, doc.current_stage])

    useEffect(() => {
        if (doc.status !== 'queued' && doc.status !== 'processing') return

        const es = new EventSource(`${BASE}/api/events/${doc.id}`)
        esRef.current = es
        es.onmessage = (e) => {
            try {
                const ev = JSON.parse(e.data)
                if (ev.progress != null) setProgress(ev.progress)
                if (ev.stage) setLiveStage(ev.stage)
                if (ev.event === 'job_completed') { setLiveStatus('completed'); setProgress(100); onRefresh(); es.close() }
                if (ev.event === 'job_failed') { setLiveStatus('failed'); onRefresh(); es.close() }

            } catch{}
        }
        es.onerror = () => es.close()
        return () => es.close()
    }, [doc.id, doc.status])

    const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete "${doc.original_filename}"?`)) return
    try {
      await deleteDocument(doc.id)
      show('Document deleted', 'success')
      onRefresh()
    } catch { show('Delete failed', 'error') }
  }

  const isActive = liveStatus === 'queued' || liveStatus === 'processing'
  return (
    <tr onClick={() => navigate(`/documents/${doc.id}`)} style={{ cursor: 'pointer' }}>
      <td>
        <div className="col-name"><span title={doc.original_filename}>{doc.original_filename}</span></div>
        <div className="col-meta">{doc.mime_type || 'unknown'}</div>
      </td>
      <td><StatusBadge status={liveStatus} /></td>
      <td>
        {isActive && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
            <ProgressBar progress={progress ?? (liveStatus === 'queued' ? 0 : 10)} status={liveStatus} />
            <span className="stage-label">{liveStage || 'waiting…'}</span>
          </div>
        )}
        {!isActive && liveStatus === 'completed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
            <ProgressBar progress={100} status="completed" />
            <span className="stage-label">{doc.finalized ? '● finalized' : 'ready to review'}</span>
          </div>
        )}
        {liveStatus === 'failed' && <span className="stage-label" style={{ color: 'var(--red)' }}>failed</span>}
      </td>
      <td className="col-meta">{formatSize(doc.file_size)}</td>
      <td className="col-meta">{format(new Date(doc.created_at), 'MMM d, HH:mm')}</td>
      <td>
        <button
          className="btn btn-sm btn-danger"
          onClick={handleDelete}
          title="Delete"
        >✕</button>
      </td>
    </tr>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<DocumentListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [sortBy, setSortBy] = useState<SortField>('created_at')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [page, setPage] = useState(1)
  const navigate = useNavigate()
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listDocuments({ search, status, sort_by: sortBy, sort_order: sortOrder, page, page_size: 20 })
      setData(res)
    } catch {}
    setLoading(false)
  }, [search, status, sortBy, sortOrder, page])

  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(load, 300)
  }, [load])

  useEffect(() => {
    const hasActive = data?.items.some(d => d.status === 'queued' || d.status === 'processing')
    if (!hasActive) return
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [data, load])

  const toggleSort = (field: SortField) => {
    if (sortBy === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortOrder('desc') }
    setPage(1)
  }

  const sortIcon = (field: SortField) =>
    sortBy === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ''

  const totalPages = data ? Math.ceil(data.total / 20) : 1

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Documents</h1>
        <button className="btn btn-primary" onClick={() => navigate('/upload')}>+ Upload</button>
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <input
            placeholder="Search by filename…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <select
          className="toolbar-select"
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          {SORT_FIELDS.map(f => (
            <button
              key={f.value}
              className={`btn btn-sm btn-secondary`}
              style={sortBy === f.value ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
              onClick={() => toggleSort(f.value)}
            >
              {f.label}{sortIcon(f.value)}
            </button>
          ))}
        </div>
        <button className="btn btn-sm btn-secondary" onClick={load} title="Refresh">↺</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading && !data ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <span className="spinner" style={{ width: 24, height: 24 }} />
          </div>
        ) : !data?.items.length ? (
          <div className="empty-state">
            <h3>No documents yet</h3>
            <p>Upload files to get started</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/upload')}>
              Upload documents
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th onClick={() => toggleSort('original_filename')}>Filename{sortIcon('original_filename')}</th>
                  <th onClick={() => toggleSort('status')}>Status{sortIcon('status')}</th>
                  <th>Progress</th>
                  <th onClick={() => toggleSort('file_size')}>Size{sortIcon('file_size')}</th>
                  <th onClick={() => toggleSort('created_at')}>Uploaded{sortIcon('created_at')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(doc => (
                  <LiveRow key={doc.id} doc={doc} onRefresh={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.total > 20 && (
        <div className="pagination">
          <button className="btn btn-sm btn-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className="page-info">Page {page} of {totalPages} · {data.total} total</span>
          <button className="btn btn-sm btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  )
}
