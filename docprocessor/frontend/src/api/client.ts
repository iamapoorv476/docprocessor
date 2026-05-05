import axios from 'axios';
import type { Document, DocumentListResponse } from '../types';

const BASE = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
});

export const uploadDocuments = async (files: File[]): Promise<Document[]> => {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  const { data } = await api.post<Document[]>('/api/documents/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export const listDocuments = async (params: {
  search?: string;
  status?: string;
  sort_by?: string;
  sort_order?: string;
  page?: number;
  page_size?: number;
}): Promise<DocumentListResponse> => {
  const { data } = await api.get<DocumentListResponse>('/api/documents', { params });
  return data;
};

export const getDocument = async (id: string): Promise<Document> => {
  const { data } = await api.get<Document>(`/api/documents/${id}`);
  return data;
};

export const updateReview = async (id: string, reviewed_data: Record<string, unknown>): Promise<Document> => {
  const { data } = await api.put<Document>(`/api/documents/${id}/review`, { reviewed_data });
  return data;
};

export const finalizeDocument = async (id: string): Promise<Document> => {
  const { data } = await api.post<Document>(`/api/documents/${id}/finalize`);
  return data;
};

export const retryDocument = async (id: string): Promise<Document> => {
  const { data } = await api.post<Document>(`/api/documents/${id}/retry`);
  return data;
};

export const deleteDocument = async (id: string): Promise<void> => {
  await api.delete(`/api/documents/${id}`);
};

export const exportDocument = (id: string, format: 'json' | 'csv') => {
  window.open(`${BASE}/api/documents/${id}/export?format=${format}`, '_blank');
};
