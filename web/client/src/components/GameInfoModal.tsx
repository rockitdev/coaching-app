import { useState, useEffect } from 'react';
import { useApp } from '../App';
import type { Video } from '../types';
import * as api from '../api/client';

interface Props {
  open: boolean;
  video: Video | null;
  onClose: () => void;
  onSaved: (updated: Video) => void;
}

export default function GameInfoModal({ open, video, onClose, onSaved }: Props) {
  const { competitions, teams } = useApp();
  const [gameDate, setGameDate] = useState('');
  const [competitionId, setCompetitionId] = useState<string>('');
  const [teamId, setTeamId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && video) {
      setGameDate(video.game_date ?? '');
      setCompetitionId(video.competition_id != null ? String(video.competition_id) : '');
      setTeamId(video.team_id != null ? String(video.team_id) : '');
      setError('');
    }
  }, [open, video]);

  if (!open || !video) return null;

  async function handleSave() {
    if (!video) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateVideoMeta(
        video.id,
        gameDate || null,
        competitionId ? parseInt(competitionId) : null,
        teamId ? parseInt(teamId) : null
      );
      // Attach names from local state
      const comp = competitions.find((c) => c.id === updated.competition_id);
      const team = teams.find((t) => t.id === updated.team_id);
      const enriched: Video = { ...updated, competition_name: comp?.name ?? null, team_name: team?.name ?? null };
      onSaved(enriched);
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
        <h2 className="modal-title">Edit Game Info</h2>

        <div className="form-group">
          <label className="form-label" htmlFor="gi-team">Team</label>
          <select
            id="gi-team"
            className="form-input"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
          >
            <option value="">(none)</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="gi-date">Game Date</label>
          <input
            id="gi-date"
            type="date"
            className="form-input"
            value={gameDate}
            onChange={(e) => setGameDate(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="gi-comp">Competition</label>
          <select
            id="gi-comp"
            className="form-input"
            value={competitionId}
            onChange={(e) => setCompetitionId(e.target.value)}
          >
            <option value="">(none)</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
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
