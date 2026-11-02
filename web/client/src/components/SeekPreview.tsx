import { useEffect, useState } from 'react';
import * as api from '../api/client';
import type { ThumbnailStatus } from '../types';
import './SeekPreview.css';

const POLL_MS = 4000;
// Half the preview's rendered width (160px frame + padding + border).
const HALF_WIDTH = 85;

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Thumbnail status for a video; polls while the server is still generating.
export function useThumbnails(videoId: number | null): ThumbnailStatus | null {
  const [status, setStatus] = useState<ThumbnailStatus | null>(null);

  useEffect(() => {
    setStatus(null);
    if (videoId === null) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const s = await api.getThumbnails(videoId);
        if (cancelled) return;
        setStatus(s);
        if (s.status === 'queued' || s.status === 'running') {
          timer = window.setTimeout(load, POLL_MS);
        }
      } catch {
        // Previews are optional; the seek bar works without them.
      }
    };
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [videoId]);

  return status;
}

interface PreviewProps {
  videoId: number;
  status: ThumbnailStatus | null;
  // Time being previewed (hover or drag), or null to hide.
  time: number | null;
  duration: number;
}

// Frame preview that floats above a seek bar. Its parent must be
// position: relative and span the slider's travel (thumb centre at 0%..100%).
export default function SeekPreview({ videoId, status, time, duration }: PreviewProps) {
  if (time === null || !duration) return null;
  const pct = Math.max(0, Math.min(100, (time / duration) * 100));

  let frame: React.ReactNode;
  if (status?.status === 'ready') {
    const perSheet = status.cols * status.rows;
    const lastFrame = Math.max(0, Math.ceil(status.duration / status.interval) - 1);
    const idx = Math.min(Math.floor(time / status.interval), lastFrame);
    const sheet = Math.floor(idx / perSheet) + 1;
    const cell = idx % perSheet;
    frame = (
      <div
        className="seek-preview-frame"
        style={{
          width: status.width,
          height: status.height,
          backgroundImage: `url(/analysis/${videoId}/sprite_${String(sheet).padStart(3, '0')}.jpg)`,
          backgroundPosition: `-${(cell % status.cols) * status.width}px -${Math.floor(cell / status.cols) * status.height}px`,
        }}
      />
    );
  } else if (status?.status === 'queued' || status?.status === 'running') {
    frame = (
      <div className="seek-preview-pending">
        Generating previews{status.status === 'running' ? ` ${Math.round(status.progress * 100)}%` : '…'}
      </div>
    );
  }

  return (
    <div
      className="seek-preview"
      style={{ left: `clamp(${HALF_WIDTH}px, ${pct}%, calc(100% - ${HALF_WIDTH}px))` }}
      aria-hidden="true"
    >
      {frame}
      <span className="seek-preview-time">{formatTime(time)}</span>
    </div>
  );
}
