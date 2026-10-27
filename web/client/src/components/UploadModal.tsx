import { useState, useRef, useEffect } from 'react';
import { useApp } from '../App';
import * as api from '../api/client';
import type { Video } from '../types';
import './UploadModal.css';

const REJECTED = new Set(['mov', 'avi', 'mkv', 'wmv']);
const ALLOWED = new Set(['mp4', 'webm']);

function ext(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: (video: Video) => void;
}

export default function UploadModal({ open, onClose, onUploaded }: Props) {
  const { competitions } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [gameDate, setGameDate] = useState('');
  const [competitionId, setCompetitionId] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (open) {
      setFile(null);
      setError('');
      setProgress(0);
      setProgressLabel('');
      setUploading(false);
      // Default date = today
      setGameDate(new Date().toISOString().slice(0, 10));
      // Default competition = Regular season
      const rs = competitions.find((c) => c.name === 'Regular season');
      setCompetitionId(rs ? String(rs.id) : '');
    }
  }, [open, competitions]);

  if (!open) return null;

  function validateFile(f: File): string | null {
    const e = ext(f.name);
    if (REJECTED.has(e)) {
      return `Unsupported format: .${e} files do not play in browsers. Please export your game recording as MP4 (H.264) and upload that.`;
    }
    if (!ALLOWED.has(e)) {
      return `Unsupported format: .${e}. Please use MP4 or WebM.`;
    }
    return null;
  }

  function pickFile(f: File) {
    const err = validateFile(f);
    if (err) { setError(err); return; }
    setError('');
    setFile(f);
  }

  async function startUpload() {
    if (!file) return;
    setError('');
    setUploading(true);
    setProgress(5);
    setProgressLabel('Uploading...');

    try {
      const result = await api.uploadVideo(
        file,
        gameDate || null,
        competitionId ? parseInt(competitionId) : null,
        (pct, label) => {
          setProgress(pct);
          setProgressLabel(label);
        }
      );
      setProgress(100);
      setProgressLabel('Upload complete!');
      onUploaded(result);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setProgress(0);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !uploading) onClose(); }}>
      <div className="modal-box upload-modal-box">
        <h2 className="modal-title">Upload Game Video</h2>

        {/* Drop zone */}
        <div
          className={`upload-drop-zone${dragOver ? ' drag-over' : ''}${file ? ' has-file' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) pickFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.webm"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickFile(f);
              e.target.value = '';
            }}
          />
          {file ? (
            <>
              <div className="upload-file-icon">✓</div>
              <div className="upload-file-name">{file.name}</div>
              <div className="upload-file-size">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </div>
            </>
          ) : (
            <>
              <div className="upload-icon">⬆</div>
              <div className="upload-hint">Tap to pick a file or drag &amp; drop</div>
              <div className="upload-formats">MP4 or WebM only</div>
            </>
          )}
        </div>

        {error && (
          <div className="upload-error">{error}</div>
        )}

        {/* Game date */}
        <div className="form-group">
          <label className="form-label" htmlFor="upload-date">Game Date</label>
          <input
            id="upload-date"
            type="date"
            className="form-input"
            value={gameDate}
            onChange={(e) => setGameDate(e.target.value)}
          />
        </div>

        {/* Competition */}
        <div className="form-group">
          <label className="form-label" htmlFor="upload-comp">Competition</label>
          <select
            id="upload-comp"
            className="form-input"
            value={competitionId}
            onChange={(e) => setCompetitionId(e.target.value)}
          >
            <option value="">(none)</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Progress bar */}
        {uploading && (
          <div className="upload-progress">
            <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
            <span className="upload-progress-label">{progressLabel}</span>
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={uploading}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={startUpload}
            disabled={!file || uploading}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
