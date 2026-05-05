import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getDocument, updateReview, finalizeDocument, retryDocument, exportDocument } from '../api/client'
import type { Document, ProgressEvent } from '../types'
import StatusBadge from '../components/StatusBadge'
import ProgressBar from '../components/ProgressBar'
import { useJobEvents } from '../hooks/useJobEvents'
import { useToast } from '../App'
import { format } from 'date-fns'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
    </div>
  )
}

// Renders the extracted/reviewed data as an editable form
function ExtractedDataEditor({
  data,
  onChange,
  disabled,
}: {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  disabled: boolean
}) {
  const renderValue = (key: string, value: unknown): React.ReactNode => {
    if (value === null || value === undefined) return null
    if (typeof value === 'object' && !Array.isArray(value)) {
      return (
        <div style={{ paddingLeft: 12, borderLeft: '2px solid var(--border)', marginTop: 4 }}>
          {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
            <div key={k} className="field-row" style={{ marginBottom: 10 }}>
              <span className="field-label">{k}</span>
              <span className="field-value mono" style={{ fontSize: 12, color: 'var(--text2)' }}>
                {String(v)}
              </span>
            </div>
          ))}
        </div>
      )
    }
    if (Array.isArray(value)) {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {(value as unknown[]).map((v, i) => (
            <span key={i} style={{
              background: 'var(--bg3)', border: '1px solid var(--border)',
              borderRadius: 3, padding: '2px 8px', fontSize: 12, fontFamily: 'var(--mono)'
            }}>
              {String(v)}
            </span>
          ))}
        </div>
      )
    }
    if (key === 'summary') {
      return (
        <textarea
          rows={3}
          value={String(value)}
          disabled={disabled}
          onChange={e => onChange(key, e.target.value)}
          style={{ marginTop: 4, resize: 'vertical' }}
        />
      )
    }
    return (
      <input
        value={String(value)}
        disabled={disabled}
        onChange={e => onChange(key, e.target.value)}
        style={{ marginTop: 4 }}
      />
    )
  }

  const editableKeys = ['title', 'category', 'summary']
  const readonlyKeys = Object.keys(data).filter(k => !editableKeys.includes(k))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div className="card-title">Editable fields</div>
        {editableKeys.filter(k => k in data).map(k => (
          <div key={k} className="field-row">
            <span className="field-label">{k}</span>
            {renderValue(k, data[k])}
          </div>
        ))}
      </div>
      <div>
        <div className="card-title">Extracted data</div>
        {readonlyKeys.map(k => (
          <div key={k} className="field-row">
            <span className="field-label">{k}</span>
            {renderValue(k, data[k])}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { show } = useToast()

  const [doc, setDoc] = useState<Document | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [editedData, setEditedData] = useState<Record<string, unknown>>({})
  const [dirty, setDirty] = useState(false)
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [progress, setProgress] = useState(0)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const d = await getDocument(id)
      setDoc(d)
      const base = d.reviewed_data || d.extracted_data || {}
      setEditedData(base)
      if (d.status === 'completed') setProgress(100)
    } catch {
      show('Failed to load document', 'error')
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const handleEvent = useCallback((ev: ProgressEvent) => {
    setEvents(prev => [...prev.slice(-49), ev])
    if (ev.progress != null) setProgress(ev.progress)
    if (ev.event === 'job_completed' || ev.event === 'job_failed') {
      setTimeout(load, 500)
    }
  }, [load])

  const { lastEvent, connected } = useJobEvents(
    doc && (doc.status === 'queued' || doc.status === 'processing') ? id! : null,
    handleEvent,
  )

  const handleFieldChange = (key: string, value: unknown) => {
    setEditedData(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    if (!doc) return
    setSaving(true)
    try {
      const updated = await updateReview(doc.id, editedData)
      setDoc(updated)
      setDirty(false)
      show('Changes saved', 'success')
    } catch { show('Save failed', 'error') }
    setSaving(false)
  }

  const handleFinalize = async () => {
    if (!doc) return
    if (dirty) { show('Save your changes before finalizing', 'info'); return }
    if (!confirm('Finalize this document? This locks it from further edits.')) return
    setFinalizing(true)
    try {
      const updated = await finalizeDocument(doc.id)
      setDoc(updated)
      show('Document finalized', 'success')
    } catch { show('Finalize failed', 'error') }
    setFinalizing(false)
  }

  const handleRetry = async () => {
    if (!doc) return
    setRetrying(true)
    try {
      const updated = await retryDocument(doc.id)
      setDoc(updated)
      setEvents([])
      setProgress(0)
      show('Job requeued', 'success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Retry failed'
      show(msg, 'error')
    }
    setRetrying(false)
  }

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <span className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  )

  if (!doc) return (
    <div className="empty-state">
      <h3>Document not found</h3>
      <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={() => navigate('/')}>← Back</button>
    </div>
  )

  const displayData = doc.reviewed_data || doc.extracted_data

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/')}>← Back</button>
        <div style={{ flex: 1 }}>
          <h1 className="section-title" style={{ marginBottom: 6 }}>{doc.original_filename}</h1>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge status={doc.status} />
            {doc.finalized && (
              <span className="badge" style={{ background: 'rgba(79,142,247,0.15)', color: 'var(--accent)' }}>
                ● finalized
              </span>
            )}
            {connected && <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--yellow)' }}>● live</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(doc.status === 'completed' || doc.finalized) && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => exportDocument(doc.id, 'json')}>Export JSON</button>
              <button className="btn btn-secondary btn-sm" onClick={() => exportDocument(doc.id, 'csv')}>Export CSV</button>
            </>
          )}
          {doc.status === 'failed' && (
            <button className="btn btn-secondary btn-sm" onClick={handleRetry} disabled={retrying}>
              {retrying ? 'Retrying…' : '↺ Retry'}
            </button>
          )}
        </div>
      </div>

      {/* Progress when active */}
      {(doc.status === 'queued' || doc.status === 'processing') && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Processing progress</div>
          <ProgressBar progress={progress} status={doc.status} />
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stage-label">{lastEvent?.stage || doc.current_stage || 'waiting…'}</span>
            <span className="stage-label">{progress}%</span>
          </div>
          {events.length > 0 && (
            <div className="event-log" style={{ marginTop: 16 }}>
              {[...events].reverse().slice(0, 8).map((ev, i) => (
                <div key={i} className="event-entry">
                  <span className="event-time">{format(new Date(ev.timestamp), 'HH:mm:ss')}</span>
                  <span className="event-name">{ev.event}</span>
                  <span className="event-msg">{ev.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Failed state */}
      {doc.status === 'failed' && doc.error_message && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--red)' }}>
          <div className="card-title" style={{ color: 'var(--red)' }}>Processing error</div>
          <code style={{ fontSize: 12, color: 'var(--red)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
            {doc.error_message}
          </code>
        </div>
      )}

      {/* Main grid */}
      <div className="detail-grid">
        {/* Left: extracted data editor */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Extracted data</div>
            {doc.status === 'completed' && !doc.finalized && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm btn-secondary" onClick={handleSave} disabled={!dirty || saving}>
                  {saving ? 'Saving…' : 'Save edits'}
                </button>
                <button className="btn btn-sm btn-success" onClick={handleFinalize} disabled={finalizing}>
                  {finalizing ? 'Finalizing…' : '✓ Finalize'}
                </button>
              </div>
            )}
          </div>

          {displayData ? (
            <ExtractedDataEditor
              data={editedData}
              onChange={handleFieldChange}
              disabled={!!doc.finalized || doc.status !== 'completed'}
            />
          ) : (
            <div className="empty-state" style={{ padding: 40 }}>
              <p>{doc.status === 'processing' || doc.status === 'queued'
                ? 'Processing in progress…'
                : 'No data extracted yet'}</p>
            </div>
          )}
        </div>

        {/* Right: metadata */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-title">File metadata</div>
            <MetaRow label="Original name" value={doc.original_filename} />
            <MetaRow label="Stored as" value={<span className="mono" style={{ fontSize: 11 }}>{doc.filename}</span>} />
            <MetaRow label="Size" value={formatSize(doc.file_size)} />
            <MetaRow label="MIME type" value={<span className="mono" style={{ fontSize: 11 }}>{doc.mime_type || 'unknown'}</span>} />
            <MetaRow label="Uploaded" value={format(new Date(doc.created_at), 'MMM d yyyy, HH:mm:ss')} />
            <MetaRow label="Updated" value={format(new Date(doc.updated_at), 'MMM d yyyy, HH:mm:ss')} />
            <MetaRow label="Document ID" value={<span className="mono" style={{ fontSize: 10, wordBreak: 'break-all' }}>{doc.id}</span>} />
          </div>

          {doc.status === 'completed' && !doc.finalized && (
            <div className="card" style={{ borderColor: 'var(--green)', background: 'rgba(34,197,94,0.04)' }}>
              <div className="card-title">Ready to finalize</div>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>
                Review the extracted fields, make any edits, then finalize to lock the record and enable export.
              </p>
              <button className="btn btn-success" style={{ width: '100%' }} onClick={handleFinalize} disabled={finalizing}>
                {finalizing ? 'Finalizing…' : '✓ Finalize document'}
              </button>
            </div>
          )}

          {doc.finalized && (
            <div className="card">
              <div className="card-title">Export</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => exportDocument(doc.id, 'json')}>
                  ↓ Download JSON
                </button>
                <button className="btn btn-secondary" onClick={() => exportDocument(doc.id, 'csv')}>
                  ↓ Download CSV
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
