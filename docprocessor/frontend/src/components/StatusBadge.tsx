import type { DocumentStatus } from '../types'

const LABELS: Record<DocumentStatus, string> = {
  queued: 'queued',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
}

export default function StatusBadge({ status }: { status: DocumentStatus }) {
  return <span className={`badge badge-${status}`}>{LABELS[status]}</span>
}
