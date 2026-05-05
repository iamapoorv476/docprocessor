export type DocumentStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface Document {
  id: string;
  filename: string;
  original_filename: string;
  file_size: number;
  mime_type: string | null;
  status: DocumentStatus;
  current_stage: string | null;
  finalized: boolean;
  extracted_data: Record<string, unknown> | null;
  reviewed_data: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentListResponse {
  items: Document[];
  total: number;
  page: number;
  page_size: number;
}

export interface ProgressEvent {
  event: string;
  document_id: string;
  stage: string | null;
  message: string | null;
  progress: number | null;
  timestamp: string;
}

export type SortOrder = 'asc' | 'desc';
export type SortField = 'created_at' | 'original_filename' | 'file_size' | 'status';
