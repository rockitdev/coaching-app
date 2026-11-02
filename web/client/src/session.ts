// Remembers what the coach was doing so an accidental reload lands back in
// place: which game was open, which view, and the playhead per game. Tags are
// already saved server-side; this covers the rest. Storage can be unavailable
// (private mode, blocked site data), so every access is best-effort.
import type VjsPlayer from 'video.js/dist/types/player';
import type { Strength, Team } from './types';

const SESSION_KEY = 'hc.session';
const POSITIONS_KEY = 'hc.positions';
const SAVE_INTERVAL_MS = 2000;
// Don't resume into the last couple of seconds -- treat that as "finished".
const END_MARGIN_SEC = 3;

export interface Session {
  teamId?: number | null;
  videoId: number | null;
  mode: 'library' | 'review';
  tab: 'video-review' | 'shot-map' | 'player-profiles';
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: resume just won't work this time.
  }
}

export const loadSession = (): Session | null => read<Session>(SESSION_KEY);
export const saveSession = (s: Session) => write(SESSION_KEY, s);

export function getPosition(videoId: number): number {
  return read<Record<string, number>>(POSITIONS_KEY)?.[videoId] ?? 0;
}

export function savePosition(videoId: number, t: number) {
  const all = read<Record<string, number>>(POSITIONS_KEY) ?? {};
  all[videoId] = Math.round(t * 10) / 10;
  write(POSITIONS_KEY, all);
}

// Capture context (team / period / strength) is sticky per game, so a reload
// mid-period keeps tagging with the same settings.
export interface CaptureContext {
  team: Team;
  period: number;
  strength: Strength;
}

const DEFAULT_CAPTURE: CaptureContext = { team: 'us', period: 1, strength: 'EV' };

export function loadCaptureContext(videoId: number): CaptureContext {
  return { ...DEFAULT_CAPTURE, ...read<Partial<CaptureContext>>(`hc.capture.${videoId}`) };
}

export function saveCaptureContext(videoId: number, ctx: CaptureContext) {
  write(`hc.capture.${videoId}`, ctx);
}

// Restores the saved playhead when a video's metadata loads, then keeps it
// saved while playing/seeking. getVideoId is read on every event because the
// library reuses one player across games.
// A one-shot jump target for the next player that loads this video. Wins over
// the saved position, which the player being torn down may overwrite as it
// disposes (e.g. jumping from the shot map into Review & Tag).
let pendingSeek: { videoId: number; time: number } | null = null;

export function requestSeek(videoId: number, time: number) {
  pendingSeek = { videoId, time };
  savePosition(videoId, time);
}

export function bindResume(player: VjsPlayer, getVideoId: () => number | null) {
  // Only save for a video once its position has been restored: right after a
  // source change the player reports t=0, which would wipe the saved spot.
  let restoredFor: number | null = null;
  let lastSave = 0;

  const save = (force: boolean) => {
    const id = getVideoId();
    if (id === null || id !== restoredFor) return;
    const now = Date.now();
    if (!force && now - lastSave < SAVE_INTERVAL_MS) return;
    lastSave = now;
    savePosition(id, player.currentTime() ?? 0);
  };

  const onLoaded = () => {
    const id = getVideoId();
    if (id === null) return;
    let t = getPosition(id);
    if (pendingSeek?.videoId === id) {
      t = pendingSeek.time;
      pendingSeek = null;
    }
    const dur = player.duration() ?? 0;
    if (t > 1 && (!dur || t < dur - END_MARGIN_SEC)) player.currentTime(t);
    restoredFor = id;
  };
  const onTime = () => save(false);
  const onForce = () => save(true);
  const onPageHide = () => save(true);

  player.on('loadedmetadata', onLoaded);
  player.on('timeupdate', onTime);
  player.on('pause', onForce);
  player.on('seeked', onForce);
  window.addEventListener('pagehide', onPageHide);
  player.on('dispose', () => {
    try { save(true); } catch { /* tech already torn down */ }
    window.removeEventListener('pagehide', onPageHide);
  });
  // Metadata may already be in if the source was set before we bound.
  if ((player.readyState() ?? 0) >= 1) onLoaded();
}
