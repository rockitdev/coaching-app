import { useState, useEffect } from 'react';
import { useApp } from '../App';
import * as api from '../api/client';
import type { GameEvent } from '../types';

interface Props {
  open: boolean;
  event: GameEvent | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function EventEditModal({ open, event, onClose, onSaved, onDeleted }: Props) {
  const { players } = useApp();
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && event) {
      setSelectedPlayerIds(new Set(event.players.map((p) => p.id)));
      setError('');
    }
  }, [open, event]);

  if (!open || !event) return null;

  function togglePlayer(pid: number) {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  async function handleSave() {
    if (!event) return;
    setSaving(true);
    try {
      await api.updateEventPlayers(event.id, Array.from(selectedPlayerIds));
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!event) return;
    if (!confirm('Delete this event?')) return;
    setSaving(true);
    try {
      await api.deleteEvent(event.id);
      onDeleted();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <h2 className="modal-title">Edit Event</h2>

        <div style={{ marginBottom: 12 }}>
          <div style={{ color: '#90caf9', fontWeight: 600, marginBottom: 4 }}>
            {event.event_type_name}
          </div>
          <div style={{ color: '#90a4ae', fontSize: '0.9rem' }}>
            At {formatTime(event.timestamp)}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Players</label>
          <div className="player-checkbox-grid">
            {players.map((p) => (
              <label key={p.id} className="player-checkbox-item">
                <input
                  type="checkbox"
                  checked={selectedPlayerIds.has(p.id)}
                  onChange={() => togglePlayer(p.id)}
                />
                <span>{p.name}</span>
              </label>
            ))}
            {players.length === 0 && (
              <span style={{ color: '#546e7a', fontSize: '0.85rem' }}>No players added yet</span>
            )}
          </div>
        </div>

        {error && <p style={{ color: '#ef5350', fontSize: '0.85rem', marginBottom: 8 }}>{error}</p>}

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={saving}>
            Delete
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
