import { useState } from 'react';
import { useApp } from '../App';
import * as api from '../api/client';
import './CompetitionsModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

// Add, rename or remove teams. A team with games or players can't be removed.
export default function TeamsModal({ open, onClose }: Props) {
  const { teams, refreshTeams } = useApp();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refreshTeams();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) { setError('Enter a team name'); return; }
    if (await run(() => api.addTeam(name))) setNewName('');
  }

  async function handleRename() {
    if (editingId === null) return;
    const name = editName.trim();
    if (!name) { setError('Enter a team name'); return; }
    if (await run(() => api.renameTeam(editingId, name))) setEditingId(null);
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Remove ${name}? Only an empty team (no games, no players) can be removed.`)) return;
    await run(() => api.deleteTeam(id));
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <h2 className="modal-title">Teams</h2>

        <ul className="comp-list">
          {teams.map((t) => (
            <li key={t.id} className="comp-item">
              {editingId === t.id ? (
                <div style={{ display: 'flex', gap: 8, flex: 1 }}>
                  <input
                    className="form-input"
                    type="text"
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleRename} disabled={busy}>Save</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)} disabled={busy}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="comp-name">{t.name}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setEditingId(t.id); setEditName(t.name); setError(''); }}
                      disabled={busy}
                    >
                      Rename
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(t.id, t.name)}
                      disabled={busy || teams.length <= 1}
                      title={teams.length <= 1 ? 'Keep at least one team' : undefined}
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="form-group" style={{ marginTop: 16 }}>
          <label className="form-label">Add Team</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. U15A Boys"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <button className="btn btn-primary" onClick={handleAdd} disabled={busy} style={{ whiteSpace: 'nowrap' }}>
              Add
            </button>
          </div>
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginTop: 8 }}>{error}</p>}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
