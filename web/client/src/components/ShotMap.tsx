import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../App';
import * as api from '../api/client';
import type { Shot, Strength, Team, Video } from '../types';
import { PERIODS, periodLabel, playerLabel, SHOT_RESULTS, SHOT_SITUATIONS, SHOT_TYPES } from '../hockey';
import { requestSeek } from '../session';
import Rink, { RINK_H, RINK_W, inHomePlate } from './Rink';
import { ShotMark } from './ShotDetails';
import './ShotMap.css';

interface Props {
  isActive: boolean;
  onSwitchToVideo: () => void;
}

type View = 'dots' | 'heat';

// Seconds of build-up shown before a shot when jumping to it from the map.
const LEAD_IN_SEC = 5;
// Heat map: density on a grid of CELL-foot squares, Gaussian kernel SIGMA feet.
const CELL = 2.5;
const SIGMA = 7;

const label = <T extends string>(list: [T, string][], v: T | null) => list.find(([k]) => k === v)?.[1] ?? null;

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const gameName = (v: { file_path: string }) => v.file_path.replace(/^\d+_/, '').replace(/\.[^.]+$/, '');

function heatCells(shots: Shot[]) {
  const cols = Math.ceil(RINK_W / CELL);
  const rows = Math.ceil(RINK_H / CELL);
  const grid = new Float64Array(cols * rows);
  for (const s of shots) {
    for (let r = 0; r < rows; r++) {
      const dy = (r + 0.5) * CELL - s.loc_y!;
      if (Math.abs(dy) > SIGMA * 3) continue;
      for (let c = 0; c < cols; c++) {
        const dx = (c + 0.5) * CELL - s.loc_x!;
        if (Math.abs(dx) > SIGMA * 3) continue;
        grid[r * cols + c] += Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
      }
    }
  }
  const max = grid.reduce((m, v) => Math.max(m, v), 0);
  const cells: { x: number; y: number; d: number }[] = [];
  if (max === 0) return cells;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = grid[r * cols + c] / max;
      if (d > 0.05) cells.push({ x: c * CELL, y: r * CELL, d });
    }
  }
  return cells;
}

function stats(shots: Shot[]) {
  const onNet = shots.filter((s) => s.shot_result === 'goal' || s.shot_result === 'saved').length;
  const goals = shots.filter((s) => s.shot_result === 'goal').length;
  const located = shots.filter((s) => s.loc_x !== null);
  const home = located.filter((s) => inHomePlate(s.loc_x!, s.loc_y!)).length;
  return {
    attempts: shots.length,
    onNet,
    goals,
    shPct: onNet > 0 ? `${Math.round((goals / onNet) * 100)}%` : '–',
    homePct: located.length > 0 ? `${Math.round((home / located.length) * 100)}%` : '–',
    unlocated: shots.length - located.length,
  };
}

export default function ShotMap({ isActive, onSwitchToVideo }: Props) {
  const { players, currentVideo, currentTeamId, enterReviewMode } = useApp();
  const [videos, setVideos] = useState<Video[]>([]);
  const [game, setGame] = useState<number | 'all'>(currentVideo?.id ?? 'all');
  const [period, setPeriod] = useState<number | null>(null);
  const [strength, setStrength] = useState<Strength | null>(null);
  const [shooter, setShooter] = useState<number | null>(null);
  const [view, setView] = useState<View>('dots');
  const [shots, setShots] = useState<Shot[]>([]);
  const [error, setError] = useState('');
  const [hover, setHover] = useState<{ shot: Shot; left: number; top: number } | null>(null);

  useEffect(() => {
    if (!isActive || currentTeamId === null) return;
    api.getVideos(currentTeamId).then(setVideos).catch(() => {});
  }, [isActive, currentTeamId]);

  // A game from the other team isn't in this list; drop back to all games.
  useEffect(() => {
    if (game !== 'all' && videos.length > 0 && !videos.some((v) => v.id === game)) setGame('all');
  }, [videos, game]);

  // Refetch whenever the tab is shown, so tags added in Review & Tag appear.
  // "All games" means all of the current team's games.
  useEffect(() => {
    if (!isActive || currentTeamId === null) return;
    setError('');
    api.getShots(game === 'all' ? undefined : game, currentTeamId)
      .then(setShots)
      .catch((e: Error) => setError(e.message));
  }, [isActive, game, currentTeamId]);

  const filtered = useMemo(
    () =>
      shots.filter(
        (s) =>
          (period === null || s.period === period) &&
          (strength === null || s.strength === strength) &&
          (shooter === null || s.players.some((p) => p.id === shooter))
      ),
    [shots, period, strength, shooter]
  );

  function jumpTo(shot: Shot) {
    const video = videos.find((v) => v.id === shot.video_id);
    if (!video) return;
    requestSeek(video.id, Math.max(0, shot.timestamp - LEAD_IN_SEC));
    enterReviewMode(video);
    onSwitchToVideo();
  }

  const panels: { team: Team; title: string; sub: string }[] = [
    { team: 'us', title: 'Shots for', sub: 'Our shots on their net' },
    { team: 'them', title: 'Shots against', sub: 'Their shots on our net' },
  ];

  const chip = <T,>(value: T, current: T, set: (v: T) => void, text: string) => (
    <button
      key={String(text)}
      type="button"
      className={`sm-chip${current === value ? ' active' : ''}`}
      aria-pressed={current === value}
      onClick={() => set(value)}
    >
      {text}
    </button>
  );

  return (
    <div className="shot-map">
      <div className="sm-filters" role="toolbar" aria-label="Shot map filters">
        <label className="sm-filter">
          <span className="sm-filter-label">Game</span>
          <select className="sm-select" value={game} onChange={(e) => setGame(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">All games</option>
            {videos.map((v) => (
              <option key={v.id} value={v.id}>{gameName(v)}</option>
            ))}
          </select>
        </label>
        <div className="sm-filter">
          <span className="sm-filter-label">Period</span>
          <div className="sm-chips" role="group" aria-label="Period">
            {chip<number | null>(null, period, setPeriod, 'All')}
            {PERIODS.map((p) => chip<number | null>(p, period, setPeriod, periodLabel(p)))}
          </div>
        </div>
        <div className="sm-filter">
          <span className="sm-filter-label">Strength</span>
          <div className="sm-chips" role="group" aria-label="Strength">
            {chip<Strength | null>(null, strength, setStrength, 'All')}
            {(['EV', 'PP', 'PK'] as Strength[]).map((s) => chip<Strength | null>(s, strength, setStrength, s))}
          </div>
        </div>
        <label className="sm-filter">
          <span className="sm-filter-label">Player</span>
          <select
            className="sm-select"
            value={shooter ?? ''}
            onChange={(e) => setShooter(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">Everyone</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>{playerLabel(p)}</option>
            ))}
          </select>
        </label>
        <div className="sm-filter sm-filter-end">
          <span className="sm-filter-label">Show</span>
          <div className="sm-chips" role="group" aria-label="View">
            {chip<View>('dots', view, setView, 'Shots')}
            {chip<View>('heat', view, setView, 'Heat')}
          </div>
        </div>
      </div>

      {error && <p className="sm-error">{error}</p>}

      <div className="sm-panels">
        {panels.map(({ team, title, sub }) => {
          const teamShots = filtered.filter((s) => s.team === team);
          const located = teamShots.filter((s) => s.loc_x !== null && s.loc_y !== null);
          const st = stats(teamShots);
          return (
            <section key={team} className={`sm-panel team-${team}`} aria-label={title}>
              <header className="sm-panel-head">
                <h2 className="sm-panel-title">
                  <span className="sm-team-swatch" aria-hidden="true" />
                  {title}
                </h2>
                <span className="sm-panel-sub">{sub}</span>
              </header>
              <dl className="sm-stats">
                <div><dt>Shots</dt><dd>{st.attempts}</dd></div>
                <div><dt>On net</dt><dd>{st.onNet}</dd></div>
                <div><dt>Goals</dt><dd>{st.goals}</dd></div>
                <div><dt>Sh%</dt><dd>{st.shPct}</dd></div>
                <div title="Share of located shots from the slot and inner circles"><dt>Home plate</dt><dd>{st.homePct}</dd></div>
              </dl>
              <div className="sm-rink-wrap" onMouseLeave={() => setHover(null)}>
                <Rink label={`${title}: ${located.length} located shots`} showHomePlate>
                  {view === 'heat' && (
                    <filter id={`sm-blur-${team}`} x="-10%" y="-10%" width="120%" height="120%">
                      <feGaussianBlur stdDeviation={CELL * 0.6} />
                    </filter>
                  )}
                  {view === 'heat'
                    ? <g filter={`url(#sm-blur-${team})`}>{heatCells(located).map((c) => (
                        <rect
                          key={`${c.x},${c.y}`}
                          className="sm-heat-cell"
                          x={c.x}
                          y={c.y}
                          width={CELL}
                          height={CELL}
                          style={{ opacity: c.d * 0.85 }}
                        />
                      ))}</g>
                    : located.map((s) => (
                        <ShotMark key={s.id} x={s.loc_x!} y={s.loc_y!} result={s.shot_result} team={s.team} />
                      ))}
                  {/* Hit targets larger than the marks */}
                  {located.map((s) => (
                    <circle
                      key={`hit-${s.id}`}
                      className="sm-hit"
                      cx={s.loc_x!}
                      cy={s.loc_y!}
                      r={3.5}
                      onMouseEnter={(e) => {
                        const box = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
                        const m = e.currentTarget.getBoundingClientRect();
                        setHover({ shot: s, left: m.left - box.left + m.width / 2, top: m.top - box.top });
                      }}
                      onClick={() => jumpTo(s)}
                    />
                  ))}
                </Rink>
                {hover && hover.shot.team === team && (
                  <div className="sm-tooltip" style={{ left: hover.left, top: hover.top }} role="tooltip">
                    <div className="sm-tooltip-title">
                      {[label(SHOT_RESULTS, hover.shot.shot_result) ?? 'Shot', label(SHOT_TYPES, hover.shot.shot_type),
                        label(SHOT_SITUATIONS, hover.shot.shot_situation)].filter(Boolean).join(' · ')}
                    </div>
                    <div>
                      {[periodLabel(hover.shot.period), formatTime(hover.shot.timestamp),
                        hover.shot.strength !== 'EV' ? hover.shot.strength : null].filter(Boolean).join(' · ')}
                    </div>
                    {hover.shot.players.length > 0 && <div>{hover.shot.players.map(playerLabel).join(', ')}</div>}
                    {game === 'all' && <div className="sm-tooltip-muted">{gameName(hover.shot)}</div>}
                    <div className="sm-tooltip-muted">Click to watch</div>
                  </div>
                )}
              </div>
              {st.unlocated > 0 && (
                <p className="sm-note">
                  {st.unlocated} shot{st.unlocated === 1 ? '' : 's'} not on the map yet. Tap Edit on a shot in
                  Review &amp; Tag to place it.
                </p>
              )}
            </section>
          );
        })}
      </div>

      {filtered.some((s) => s.team === null) && (
        <p className="sm-note">
          {filtered.filter((s) => s.team === null).length} shots have no team set, so they aren't shown above.
          They're in the shot list below.
        </p>
      )}

      <div className="sm-legend" aria-label="Legend">
        {(['goal', 'saved', 'missed', 'blocked', null] as const).map((r) => (
          <span key={r ?? 'unknown'} className="sm-legend-item">
            <svg viewBox="-4 -4 8 8" width="16" height="16" aria-hidden="true">
              <ShotMark x={0} y={0} result={r} team={null} scale={1.2} />
            </svg>
            {label(SHOT_RESULTS, r) ?? 'Result not set'}
          </span>
        ))}
        <span className="sm-legend-item">
          <svg viewBox="0 0 16 10" width="20" height="12" aria-hidden="true">
            <rect x={1} y={1} width={14} height={8} className="sm-legend-plate" />
          </svg>
          Home plate (slot + inner circles)
        </span>
      </div>

      <details className="sm-table-wrap">
        <summary>Shot list ({filtered.length})</summary>
        <table className="sm-table">
          <thead>
            <tr>
              <th>Team</th><th>Time</th>{game === 'all' && <th>Game</th>}<th>Result</th><th>Type</th>
              <th>Situation</th><th>Players</th><th>Spot</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} onClick={() => jumpTo(s)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') jumpTo(s); }}>
                <td>{s.team === 'us' ? 'Us' : s.team === 'them' ? 'Them' : '–'}</td>
                <td>{[periodLabel(s.period), formatTime(s.timestamp)].filter(Boolean).join(' ')}</td>
                {game === 'all' && <td>{gameName(s)}</td>}
                <td>{label(SHOT_RESULTS, s.shot_result) ?? '–'}</td>
                <td>{label(SHOT_TYPES, s.shot_type) ?? '–'}</td>
                <td>{label(SHOT_SITUATIONS, s.shot_situation) ?? '–'}</td>
                <td>{s.players.map(playerLabel).join(', ') || '–'}</td>
                <td>{s.loc_x !== null ? (inHomePlate(s.loc_x, s.loc_y!) ? 'Home plate' : 'Outside') : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
