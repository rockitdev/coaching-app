import { useState, useEffect, useMemo } from 'react';
import * as api from '../api/client';
import type { EventType, GameEvent, ExportStatus, Team } from '../types';

interface Props {
  open: boolean;
  videoId: number;
  events: GameEvent[];
  eventTypes: EventType[];
  onClose: () => void;
}

interface Settings {
  pre: number;
  post: number;
  captions: boolean;
}

const SETTINGS_KEY = 'hc.highlights';
const DEFAULT_TYPES = ['shot', 'goal'];

function loadSettings(): Settings {
  const fallback = { pre: 6, post: 4, captions: true };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable -- settings just won't stick
  }
}

function mmss(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Mirrors the server's clip building: one window per tag, overlapping windows
// merged, so the preview count matches what gets rendered.
function planClips(times: number[], pre: number, post: number) {
  const clips: { start: number; end: number }[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    const start = Math.max(0, t - pre);
    const prev = clips[clips.length - 1];
    if (prev && start <= prev.end) prev.end = Math.max(prev.end, t + post);
    else clips.push({ start, end: t + post });
  }
  return { count: clips.length, duration: clips.reduce((s, c) => s + c.end - c.start, 0) };
}

// Export every tag of the chosen types as one captioned highlight reel.
export default function HighlightsModal({ open, videoId, events, eventTypes, onClose }: Props) {
  const [typeIds, setTypeIds] = useState<Set<number>>(new Set());
  const [team, setTeam] = useState<Team | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [job, setJob] = useState<ExportStatus | null>(null);
  const [error, setError] = useState('');

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of events) {
      if (team && e.team !== team) continue;
      m.set(e.event_type_id, (m.get(e.event_type_id) ?? 0) + 1);
    }
    return m;
  }, [events, team]);

  useEffect(() => {
    if (!open) return;
    setTypeIds(new Set(eventTypes.filter((t) => DEFAULT_TYPES.includes(t.name.toLowerCase())).map((t) => t.id)));
    setTeam(null);
    setJob(null);
    setError('');
  }, [open, videoId, eventTypes]);

  useEffect(() => saveSettings(settings), [settings]);

  // Changing anything after a finished render offers a fresh export.
  useEffect(() => {
    setJob((j) => (j && (j.state === 'ready' || j.state === 'error') ? null : j));
  }, [typeIds, team, settings]);

  // Poll the render until it finishes.
  const jobId = job?.id;
  const jobDone = job?.state === 'ready' || job?.state === 'error';
  useEffect(() => {
    if (!jobId || jobDone) return;
    const t = setInterval(() => {
      api.getExport(jobId).then(setJob).catch((e: Error) => setError(e.message));
    }, 1000);
    return () => clearInterval(t);
  }, [jobId, jobDone]);

  const plan = useMemo(
    () =>
      planClips(
        events.filter((e) => typeIds.has(e.event_type_id) && (!team || e.team === team)).map((e) => e.timestamp),
        settings.pre,
        settings.post
      ),
    [events, typeIds, team, settings.pre, settings.post]
  );

  if (!open) return null;

  const busy = job !== null && !jobDone;

  function toggleType(id: number) {
    setTypeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleExport() {
    setError('');
    try {
      setJob(await api.startExport({ videoId, typeIds: [...typeIds], team, ...settings }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const secondsInput = (key: 'pre' | 'post', label: string) => (
    <div className="form-group" style={{ flex: 1 }}>
      <label className="form-label" htmlFor={`hl-${key}`}>{label}</label>
      <input
        id={`hl-${key}`}
        className="form-input"
        type="number"
        min={0}
        max={60}
        step={1}
        value={settings[key]}
        disabled={busy}
        onChange={(e) => {
          const v = Math.min(60, Math.max(0, Number(e.target.value) || 0));
          setSettings((s) => ({ ...s, [key]: v }));
        }}
      />
    </div>
  );

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-box">
        <h2 className="modal-title">Export highlights</h2>

        <div className="form-group">
          <span className="form-label">Tags to include</span>
          <div role="group" aria-label="Tags to include" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {eventTypes.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`btn btn-sm ${typeIds.has(t.id) ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={typeIds.has(t.id)}
                disabled={busy}
                onClick={() => toggleType(t.id)}
              >
                {t.name} <span style={{ opacity: 0.7 }}>{counts.get(t.id) ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <span className="form-label">Team</span>
          <div role="group" aria-label="Team" style={{ display: 'flex', gap: 6 }}>
            {([[null, 'Both'], ['us', 'Us'], ['them', 'Them']] as [Team | null, string][]).map(([v, text]) => (
              <button
                key={text}
                type="button"
                className={`btn btn-sm ${team === v ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={team === v}
                disabled={busy}
                onClick={() => setTeam(v)}
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          {secondsInput('pre', 'Seconds before')}
          {secondsInput('post', 'Seconds after')}
        </div>

        <label className="form-group" style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.captions}
            disabled={busy}
            onChange={(e) => setSettings((s) => ({ ...s, captions: e.target.checked }))}
          />
          <span>Caption each clip (period, tag, players)</span>
        </label>

        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-med)', marginBottom: 8 }}>
          {plan.count === 0
            ? 'No tags match.'
            : `${plan.count} clip${plan.count === 1 ? '' : 's'} · about ${mmss(plan.duration)}. Overlapping tags play as one clip.`}
        </p>

        {job && (
          <div style={{ marginBottom: 8 }}>
            {job.state === 'ready' ? (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-high)' }}>
                Reel ready: {job.clips} clips, {mmss(job.duration)}.
              </p>
            ) : job.state === 'error' ? (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>Export failed: {job.error}</p>
            ) : (
              <>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-med)', marginBottom: 6 }}>
                  {job.state === 'queued' ? 'Waiting to start…' : `Rendering… ${Math.round(job.progress * 100)}%`}
                </p>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-raised)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.round(job.progress * 100)}%`,
                      height: '100%',
                      background: 'var(--accent)',
                      transition: 'width 0.5s',
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginBottom: 8 }}>{error}</p>}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {job?.state === 'ready' ? 'Done' : 'Cancel'}
          </button>
          {job?.state === 'ready' ? (
            <a className="btn btn-primary" href={api.exportDownloadUrl(job.id)} download>
              Download MP4
            </a>
          ) : (
            <button className="btn btn-primary" onClick={handleExport} disabled={busy || plan.count === 0}>
              {busy ? 'Exporting…' : 'Export reel'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
