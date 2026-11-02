import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../App';
import * as api from '../api/client';
import type { GameEvent, ShotDetails, Strength, Team } from '../types';
import { PERIODS, periodLabel, periodCascade, playerLabel, isShot } from '../hockey';
import ShotDetailsEditor from './ShotDetails';

interface Props {
  open: boolean;
  event: GameEvent | null;
  // The game's tags, so a period change can offer to cascade to later ones.
  events?: GameEvent[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function EventEditModal({ open, event, events = [], onClose, onSaved, onDeleted }: Props) {
  const { players, eventTypes } = useApp();
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<number>>(new Set());
  const [timestamp, setTimestamp] = useState(0);
  const [team, setTeam] = useState<Team | null>(null);
  const [period, setPeriod] = useState<number | null>(null);
  const [strength, setStrength] = useState<Strength | null>(null);
  const [cascadePeriod, setCascadePeriod] = useState(true);
  const [shot, setShot] = useState<Partial<ShotDetails>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && event) {
      setSelectedPlayerIds(new Set(event.players.map((p) => p.id)));
      setTimestamp(event.timestamp);
      setTeam(event.team);
      setPeriod(event.period);
      setStrength(event.strength);
      setCascadePeriod(true);
      setShot({});
      setError('');
    }
  }, [open, event]);

  const laterInPeriod = useMemo(() => (event ? periodCascade(events, event.id) : []), [events, event]);
  const periodChanged = event !== null && period !== event.period;
  const willCascade = periodChanged && cascadePeriod && laterInPeriod.length > 0;

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
      if (
        timestamp !== event.timestamp || team !== event.team ||
        period !== event.period || strength !== event.strength ||
        Object.keys(shot).length > 0
      ) {
        await api.updateEvent(event.id, {
          timestamp, team, period, strength, ...shot,
          ...(willCascade ? { cascade_period: true } : {}),
        });
      }
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
      <div className="modal-box" style={isShot(eventTypes, event.event_type_id) ? { maxWidth: 640 } : undefined}>
        <h2 className="modal-title">Edit Event</h2>

        <div style={{ marginBottom: 12 }}>
          <div style={{ color: 'var(--amber)', fontWeight: 600, marginBottom: 6 }}>
            {event.event_type_name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-med)', fontSize: 'var(--text-sm)' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setTimestamp((t) => Math.max(0, t - 0.5))}
              aria-label="Move 0.5 seconds earlier"
            >
              −0.5s
            </button>
            <span style={{ color: 'var(--ice)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {formatTime(timestamp)}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setTimestamp((t) => t + 0.5)}
              aria-label="Move 0.5 seconds later"
            >
              +0.5s
            </button>
          </div>
        </div>

        <OptionRow
          label="Team"
          options={[['us', 'Us'], ['them', 'Them']]}
          value={team}
          onChange={setTeam}
        />
        <OptionRow
          label="Period"
          options={PERIODS.map((p) => [p, periodLabel(p)])}
          value={period}
          onChange={setPeriod}
        />
        {periodChanged && laterInPeriod.length > 0 && (
          <label
            className="form-group"
            style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 'var(--text-sm)', marginTop: -6 }}
          >
            <input type="checkbox" checked={cascadePeriod} onChange={(e) => setCascadePeriod(e.target.checked)} />
            <span>
              Also move the {laterInPeriod.length} later tag{laterInPeriod.length === 1 ? '' : 's'}
              {event.period !== null ? ` in ${periodLabel(event.period)}` : ' with no period'}
              {' '}to {period !== null ? periodLabel(period) : 'no period'}
            </span>
          </label>
        )}
        <OptionRow
          label="Strength"
          options={[['EV', 'EV'], ['PP', 'PP'], ['PK', 'PK']]}
          value={strength}
          onChange={setStrength}
        />

        {isShot(eventTypes, event.event_type_id) && (
          <div className="form-group">
            <span className="form-label">Shot</span>
            <ShotDetailsEditor
              value={{ ...event, ...shot }}
              team={team}
              onChange={(patch) => setShot((s) => ({ ...s, ...patch }))}
              compact
            />
          </div>
        )}

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
                <span>{playerLabel(p)}</span>
              </label>
            ))}
            {players.length === 0 && (
              <span style={{ color: 'var(--text-low)', fontSize: 'var(--text-sm)' }}>No players added yet</span>
            )}
          </div>
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginBottom: 8 }}>{error}</p>}

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

// One row of toggle buttons; clicking the active option clears it (unknown).
function OptionRow<T extends string | number>({
  label, options, value, onChange,
}: {
  label: string;
  options: [T, string][];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="form-group">
      <span className="form-label">{label}</span>
      <div role="group" aria-label={label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            className={`btn btn-sm ${value === v ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={value === v}
            onClick={() => onChange(value === v ? null : v)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
