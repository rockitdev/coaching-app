import { useState, useEffect, useRef } from 'react';
import type { Player } from '../types';
import type { PlayerFields } from '../api/client';

const POSITIONS: [string, string][] = [['F', 'Forward'], ['D', 'Defence'], ['G', 'Goalie']];

interface Props {
  title: string;
  player?: Player | null;
  open: boolean;
  onClose: () => void;
  onSave: (fields: PlayerFields) => Promise<void>;
}

// Add / edit a roster player: name, jersey number and position.
export default function PlayerModal({ title, player, open, onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [position, setPosition] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const numberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(player?.name ?? '');
      setNumber(player?.number != null ? String(player.number) : '');
      setPosition(player?.position ?? '');
      setError('');
      setTimeout(() => numberRef.current?.focus(), 50);
    }
  }, [open, player]);

  if (!open) return null;

  async function handleSave() {
    const n = name.trim();
    if (!n) { setError('Please enter a name'); return; }
    const num = number.trim() === '' ? null : Number(number);
    if (num !== null && !(Number.isInteger(num) && num >= 0 && num <= 99)) {
      setError('Jersey number must be 0–99');
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: n, number: num, position: position || null });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <h2 className="modal-title">{title}</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="form-group" style={{ width: 90 }}>
            <label className="form-label" htmlFor="pm-number">Number</label>
            <input
              id="pm-number"
              ref={numberRef}
              className="form-input"
              type="text"
              inputMode="numeric"
              placeholder="#"
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              onKeyDown={handleKey}
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label" htmlFor="pm-name">Name</label>
            <input
              id="pm-name"
              className="form-input"
              type="text"
              placeholder="Player name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKey}
            />
          </div>
        </div>
        <div className="form-group">
          <span className="form-label">Position</span>
          <div role="group" aria-label="Position" style={{ display: 'flex', gap: 6 }}>
            {POSITIONS.map(([code, label]) => (
              <button
                key={code}
                type="button"
                className={`btn btn-sm ${position === code ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={position === code}
                onClick={() => setPosition(position === code ? '' : code)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginBottom: 8 }}>{error}</p>}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
