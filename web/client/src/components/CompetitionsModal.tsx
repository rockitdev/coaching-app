import { useState } from 'react';
import { useApp } from '../App';
import * as api from '../api/client';
import './CompetitionsModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CompetitionsModal({ open, onClose }: Props) {
  const { competitions, refreshCompetitions } = useApp();
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  async function handleAdd() {
    const name = newName.trim();
    if (!name) { setError('Enter a competition name'); return; }
    setAdding(true);
    setError('');
    try {
      await api.addCompetition(name);
      await refreshCompetitions();
      setNewName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <h2 className="modal-title">Competitions</h2>

        <ul className="comp-list">
          {competitions.map((c) => (
            <li key={c.id} className="comp-item">
              <span className="comp-name">{c.name}</span>
              {c.is_custom === 0 && (
                <span className="comp-badge">default</span>
              )}
            </li>
          ))}
        </ul>

        <div className="form-group" style={{ marginTop: 16 }}>
          <label className="form-label">Add Custom Competition</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Tournament A"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <button className="btn btn-primary" onClick={handleAdd} disabled={adding} style={{ whiteSpace: 'nowrap' }}>
              Add
            </button>
          </div>
        </div>

        {error && <p style={{ color: '#ef5350', fontSize: '0.85rem', marginTop: 8 }}>{error}</p>}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
