import { useEffect, useRef, useState } from 'react';
import type { ProgressEvent } from '../types';

const BASE = import.meta.env.VITE_API_URL || '';
const TERMINAL_EVENTS = new Set(['job_completed', 'job_failed', 'job_cancelled']);

export function useJobEvents(documentId: string | null, onEvent?: (e: ProgressEvent) => void) {
  const [lastEvent, setLastEvent] = useState<ProgressEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!documentId) return;

    const url = `${BASE}/api/events/${documentId}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const event: ProgressEvent = JSON.parse(e.data);
        setLastEvent(event);
        onEvent?.(event);
        if (TERMINAL_EVENTS.has(event.event)) {
          es.close();
          setConnected(false);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [documentId]);

  const close = () => {
    esRef.current?.close();
    setConnected(false);
  };

  return { lastEvent, connected, close };
}
