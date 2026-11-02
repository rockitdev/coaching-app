import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../App';
import * as api from '../api/client';
import type { GameEvent, ShotDetails, Strength, Team } from '../types';
import { TAG_KEYS, tagIndexForKey, isTypingTarget } from '../shortcuts';
import ShotDetailsEditor from './ShotDetails';
import { bindResume, loadCaptureContext, saveCaptureContext, type CaptureContext } from '../session';
import { PERIODS, periodLabel, periodCascade, playerLabel, isShot, REBOUND_SEC, computeZones, zoneTotals } from '../hockey';
import VideoPlayer from './VideoPlayer';
import SeekPreview, { useThumbnails } from './SeekPreview';
import {
  PlayIcon, PauseIcon, PrevEventIcon, NextEventIcon, UndoIcon, CloseIcon, BackIcon,
} from './Icons';
import type VjsPlayer from 'video.js/dist/types/player';
import './ReviewAndTagMode.css';

const FRAME_SEC = 1 / 30;
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5];
// Seconds subtracted from the playhead when tagging, to cover reaction time.
const PRE_ROLL_OPTIONS = [0, 2, 3, 5];
const PRE_ROLL_STORAGE_KEY = 'hc.preRoll';
const RETIME_STEP = 0.5;
const TOAST_MS = 2500;

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function clamp(t: number, dur: number) {
  return Math.max(0, Math.min(t, dur || 0));
}

function loadPreRoll(): number {
  try {
    const v = Number(localStorage.getItem(PRE_ROLL_STORAGE_KEY));
    return PRE_ROLL_OPTIONS.includes(v) ? v : 0;
  } catch {
    return 0;
  }
}

function savePreRoll(v: number) {
  try {
    localStorage.setItem(PRE_ROLL_STORAGE_KEY, String(v));
  } catch {
    // Private mode / blocked storage: the setting just won't persist.
  }
}

// Undo history for this session. Deleting an event and then undoing recreates
// it with a new id, so entries are remapped when that happens.
type UndoEntry =
  | { kind: 'create'; id: number }
  | { kind: 'delete'; event: GameEvent };

interface Toast {
  text: string;
  tone: 'ok' | 'error';
}

const SHORTCUT_HELP: [string, string][] = [
  ['Space / K', 'Play / pause'],
  ['J / L', 'Slower / faster'],
  ['← / →', 'Back / forward 5s (Shift: 10s)'],
  [', / .', 'Back / forward one frame'],
  ['[ / ]', 'Previous / next event'],
  ['1–0, Q–P', 'Tag event type'],
  ['Z', 'Undo last change'],
  ['Tab', 'Switch team (us / them)'],
  ['# then 7, Enter', 'Toggle jersey #7 on last tag'],
  ['- / =', 'Retime last tag ±0.5s'],
  ['Esc', 'Close panel / exit'],
  ['?', 'This sheet'],
];

// ---------------------------------------------------------------------------
// Main Review & Tag mode
// ---------------------------------------------------------------------------
export default function ReviewAndTagMode() {
  const { players, eventTypes, reviewVideo, exitReviewMode, refreshEventTypes } = useApp();
  const thumbs = useThumbnails(reviewVideo?.id ?? null);

  // Local video.js player (separate instance from VideoReview)
  const localPlayerRef = useRef<VjsPlayer | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  // scrubTime is set while the user is dragging the seek bar.
  // We show the scrub position but don't seek until pointer release --
  // this prevents rapid currentTime calls fighting the timeupdate listener
  // and avoids excessive Range-request churn during a drag.
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  // Mouse hover position over the seek bar, for the frame preview.
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [eventsOpen, setEventsOpen] = useState(true);
  // The most recent tag: drives the inline player-attach strip. Tagging never
  // opens a modal, so playback keeps running while players are attached.
  const [lastTagId, setLastTagId] = useState<number | null>(null);
  const [preRoll, setPreRoll] = useState(loadPreRoll);
  const [toast, setToast] = useState<Toast | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // Team / period / strength applied to new tags; sticky per game.
  const [capture, setCapture] = useState<CaptureContext>(() =>
    reviewVideo ? loadCaptureContext(reviewVideo.id) : { team: 'us', period: 1, strength: 'EV' }
  );
  // Jersey number being typed after '#', or null when not in number entry.
  const [numberEntry, setNumberEntry] = useState<string | null>(null);
  const [addTypeMode, setAddTypeMode] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  const undoStack = useRef<UndoEntry[]>([]);
  const toastTimer = useRef<number | undefined>(undefined);
  // Mirrors `events` so async handlers read the latest list.
  const eventsRef = useRef<GameEvent[]>([]);
  eventsRef.current = events;

  const loadEvents = useCallback(async () => {
    if (!reviewVideo) return;
    const evs = await api.getVideoEvents(reviewVideo.id).catch(() => []);
    setEvents(evs);
  }, [reviewVideo]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const showToast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const patchEvent = useCallback((id: number, patch: Partial<GameEvent>) => {
    setEvents((prev) => prev.map((ev) => (ev.id === id ? { ...ev, ...patch } : ev)));
  }, []);

  // Handle player ready: set source and hide video.js native controls
  function handlePlayerReady(player: VjsPlayer) {
    if (reviewVideo) {
      // Resume where this game was last left (reload, or coming from the library)
      const videoId = reviewVideo.id;
      bindResume(player, () => videoId);
      player.src({ src: `/videos/${reviewVideo.file_path}`, type: 'video/mp4' });
    }
    // Hide video.js native control bar - we provide our own
    player.controls(false);

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(player.currentTime() ?? 0);
    const onLoaded = () => {
      setDuration(player.duration() ?? 0);
      setCurrentTime(0);
    };
    const onRate = () => setSpeed(player.playbackRate() ?? 1);

    player.on('play', onPlay);
    player.on('pause', onPause);
    player.on('timeupdate', onTimeUpdate);
    player.on('loadedmetadata', onLoaded);
    player.on('ratechange', onRate);
    // No cleanup here - VideoPlayer disposes on unmount which cleans up all listeners
  }

  // Transport controls
  const togglePlay = useCallback(() => {
    const p = localPlayerRef.current;
    if (!p) return;
    if (p.paused()) p.play();
    else p.pause();
  }, []);

  const seek = useCallback((offset: number) => {
    const p = localPlayerRef.current;
    if (!p) return;
    p.currentTime(clamp((p.currentTime() ?? 0) + offset, p.duration() ?? 0));
  }, []);

  const seekTo = useCallback((t: number) => {
    const p = localPlayerRef.current;
    if (!p) return;
    p.currentTime(clamp(t, p.duration() ?? 0));
  }, []);

  const frameBack = useCallback(() => {
    const p = localPlayerRef.current;
    if (!p) return;
    p.pause();
    p.currentTime(clamp((p.currentTime() ?? 0) - FRAME_SEC, p.duration() ?? 0));
  }, []);

  const frameFwd = useCallback(() => {
    const p = localPlayerRef.current;
    if (!p) return;
    p.pause();
    p.currentTime(clamp((p.currentTime() ?? 0) + FRAME_SEC, p.duration() ?? 0));
  }, []);

  const prevEvent = useCallback(() => {
    const p = localPlayerRef.current;
    if (!p) return;
    const t = p.currentTime() ?? 0;
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const prev = [...sorted].reverse().find((ev) => ev.timestamp < t - 0.1);
    if (prev) p.currentTime(prev.timestamp);
  }, [events]);

  const nextEvent = useCallback(() => {
    const p = localPlayerRef.current;
    if (!p) return;
    const t = p.currentTime() ?? 0;
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const next = sorted.find((ev) => ev.timestamp > t + 0.1);
    if (next) p.currentTime(next.timestamp);
  }, [events]);

  const setRate = useCallback((rate: number) => {
    const p = localPlayerRef.current;
    if (!p) return;
    p.playbackRate(rate);
    setSpeed(rate);
  }, []);

  const stepRate = useCallback((dir: 1 | -1) => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (idx === -1 ? 3 : idx) + dir))];
    setRate(next);
  }, [speed, setRate]);

  function commitScrub() {
    if (scrubTime === null) return;
    seekTo(scrubTime);
    setScrubTime(null);
  }

  // Tag an event at the current timestamp (minus pre-roll) - the core interaction
  const tagEvent = useCallback(async (eventTypeId: number) => {
    const p = localPlayerRef.current;
    const et = eventTypes.find((t) => t.id === eventTypeId);
    if (!reviewVideo || !p || !et) return;
    const timestamp = Math.max(0, (p.currentTime() ?? 0) - preRoll);
    const context = { team: capture.team, period: capture.period, strength: capture.strength };
    // A shot right after the same team's last shot is a rebound.
    const rebound = et.shot_kind !== null && eventsRef.current.some((e) =>
      e.team === capture.team && isShot(eventTypes, e.event_type_id) &&
      e.timestamp < timestamp && timestamp - e.timestamp <= REBOUND_SEC
    );
    const details: ShotDetails = {
      shot_result: et.shot_kind === 'goal' ? 'goal' : null,
      shot_type: null,
      shot_situation: rebound ? 'rebound' : null,
      loc_x: null,
      loc_y: null,
    };
    try {
      const { id } = await api.addEvent(reviewVideo.id, eventTypeId, timestamp, {
        ...context,
        ...(rebound ? { shot_situation: 'rebound' as const } : {}),
      });
      setEvents((prev) => [
        ...prev,
        {
          id,
          video_id: reviewVideo.id,
          event_type_id: eventTypeId,
          event_type_name: et.name,
          timestamp,
          players: [],
          ...context,
          ...details,
        },
      ]);
      undoStack.current.push({ kind: 'create', id });
      setLastTagId(id);
      setNumberEntry(null);
      showToast(`${et.name} · ${capture.team === 'us' ? 'Us' : 'Them'} · ${formatTime(timestamp)}`);
    } catch (e) {
      showToast(`Tag failed: ${(e as Error).message}`, 'error');
    }
  }, [eventTypes, reviewVideo, preRoll, capture, showToast]);

  const deleteEvent = useCallback(async (ev: GameEvent) => {
    setEvents((prev) => prev.filter((e) => e.id !== ev.id));
    setLastTagId((cur) => (cur === ev.id ? null : cur));
    try {
      await api.deleteEvent(ev.id);
      undoStack.current.push({ kind: 'delete', event: ev });
      showToast(`Deleted ${ev.event_type_name} · ${formatTime(ev.timestamp)} (Z to undo)`);
    } catch (e) {
      setEvents((prev) => [...prev, ev]);
      showToast(`Delete failed: ${(e as Error).message}`, 'error');
    }
  }, [showToast]);

  const undo = useCallback(async () => {
    // Skip create entries whose event is already gone (deleted and not restored).
    const isStale = (u: UndoEntry | undefined) =>
      u?.kind === 'create' && !eventsRef.current.some((e) => e.id === u.id);
    let entry = undoStack.current.pop();
    while (isStale(entry)) entry = undoStack.current.pop();
    if (!entry) {
      showToast('Nothing to undo');
      return;
    }
    try {
      if (entry.kind === 'create') {
        const id = entry.id;
        const ev = eventsRef.current.find((e) => e.id === id)!;
        await api.deleteEvent(id);
        setEvents((prev) => prev.filter((e) => e.id !== id));
        setLastTagId((cur) => (cur === id ? null : cur));
        showToast(`Undid ${ev.event_type_name} · ${formatTime(ev.timestamp)}`);
      } else {
        const ev = entry.event;
        const { id } = await api.addEvent(ev.video_id, ev.event_type_id, ev.timestamp, {
          team: ev.team, period: ev.period, strength: ev.strength,
          shot_result: ev.shot_result, shot_type: ev.shot_type, shot_situation: ev.shot_situation,
          loc_x: ev.loc_x, loc_y: ev.loc_y,
        });
        if (ev.players.length > 0) {
          await api.updateEventPlayers(id, ev.players.map((p) => p.id));
        }
        undoStack.current = undoStack.current.map((u) =>
          u.kind === 'create' && u.id === ev.id ? { kind: 'create', id } : u
        );
        setEvents((prev) => [...prev, { ...ev, id }]);
        showToast(`Restored ${ev.event_type_name} · ${formatTime(ev.timestamp)}`);
      }
    } catch (e) {
      undoStack.current.push(entry);
      showToast(`Undo failed: ${(e as Error).message}`, 'error');
    }
  }, [showToast]);

  const lastTag = events.find((e) => e.id === lastTagId) ?? null;

  // Player toggles save immediately, so nothing is lost if the strip is
  // dismissed or the next tag replaces it.
  async function toggleLastTagPlayer(playerId: number) {
    if (!lastTag) return;
    const before = lastTag.players;
    const has = before.some((p) => p.id === playerId);
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    const after = has ? before.filter((p) => p.id !== playerId) : [...before, player];
    patchEvent(lastTag.id, { players: after });
    try {
      await api.updateEventPlayers(lastTag.id, after.map((p) => p.id));
    } catch (e) {
      patchEvent(lastTag.id, { players: before });
      showToast(`Couldn't save players: ${(e as Error).message}`, 'error');
    }
  }

  const retimeLastTag = useCallback(async (delta: number) => {
    const ev = eventsRef.current.find((e) => e.id === lastTagId);
    if (!ev) return;
    const t = clamp(ev.timestamp + delta, localPlayerRef.current?.duration() ?? ev.timestamp + delta);
    patchEvent(ev.id, { timestamp: t });
    seekTo(t);
    try {
      await api.updateEvent(ev.id, { timestamp: t });
    } catch (e) {
      patchEvent(ev.id, { timestamp: ev.timestamp });
      showToast(`Retime failed: ${(e as Error).message}`, 'error');
    }
  }, [lastTagId, patchEvent, seekTo, showToast]);

  function updateCapture(patch: Partial<CaptureContext>) {
    setCapture((prev) => {
      const next = { ...prev, ...patch };
      if (reviewVideo) saveCaptureContext(reviewVideo.id, next);
      return next;
    });
  }

  async function setLastTagTeam(team: Team) {
    if (!lastTag || lastTag.team === team) return;
    const before = lastTag.team;
    patchEvent(lastTag.id, { team });
    try {
      await api.updateEvent(lastTag.id, { team });
    } catch (e) {
      patchEvent(lastTag.id, { team: before });
      showToast(`Couldn't change team: ${(e as Error).message}`, 'error');
    }
  }

  // Shot details on the last tag. The server files a goal under the Goal type
  // and anything else under Shot, so take the type back from its reply.
  async function updateLastTagShot(patch: Partial<ShotDetails>) {
    if (!lastTag) return;
    const before = lastTag;
    patchEvent(before.id, patch);
    try {
      const res = await api.updateEvent(before.id, patch);
      const typeId = (res as { event_type_id?: number }).event_type_id;
      const type = typeId !== undefined ? eventTypes.find((t) => t.id === typeId) : undefined;
      if (type) patchEvent(before.id, { event_type_id: type.id, event_type_name: type.name });
    } catch (e) {
      patchEvent(before.id, {
        shot_result: before.shot_result, shot_type: before.shot_type, shot_situation: before.shot_situation,
        loc_x: before.loc_x, loc_y: before.loc_y,
      });
      showToast(`Couldn't save shot details: ${(e as Error).message}`, 'error');
    }
  }

  // Changing a tag's period carries the later tags still in its old period
  // along (see periodCascade); if that reaches the newest tag, new tags
  // follow the new period too.
  async function setLastTagPeriod(period: number) {
    if (!lastTag || lastTag.period === period) return;
    const run = periodCascade(eventsRef.current, lastTag.id);
    const moved = [lastTag, ...run];
    const ids = new Set(moved.map((e) => e.id));
    const newest = [...eventsRef.current].sort((a, b) => b.timestamp - a.timestamp || b.id - a.id)[0];
    setEvents((prev) => prev.map((e) => (ids.has(e.id) ? { ...e, period } : e)));
    try {
      await api.updateEvent(lastTag.id, { period, cascade_period: true });
      if (newest && ids.has(newest.id)) updateCapture({ period });
      showToast(
        run.length > 0
          ? `${periodLabel(period)} · also moved ${run.length} later tag${run.length === 1 ? '' : 's'}`
          : `Moved to ${periodLabel(period)}`
      );
    } catch (e) {
      const was = new Map(moved.map((m) => [m.id, m.period]));
      setEvents((prev) => prev.map((ev) => (was.has(ev.id) ? { ...ev, period: was.get(ev.id) ?? null } : ev)));
      showToast(`Couldn't change period: ${(e as Error).message}`, 'error');
    }
  }

  function commitNumberEntry() {
    const typed = numberEntry;
    setNumberEntry(null);
    if (!typed) return;
    if (!lastTag) {
      showToast('Tag an event first, then add players', 'error');
      return;
    }
    const player = players.find((p) => p.number === Number(typed));
    if (!player) {
      showToast(`No player #${typed} on the roster`, 'error');
      return;
    }
    toggleLastTagPlayer(player.id);
  }

  function cyclePreRoll() {
    const next = PRE_ROLL_OPTIONS[(PRE_ROLL_OPTIONS.indexOf(preRoll) + 1) % PRE_ROLL_OPTIONS.length];
    setPreRoll(next);
    savePreRoll(next);
  }

  async function addCustomType() {
    const name = newTypeName.trim();
    if (!name) return;
    await api.addEventType(name, true);
    await refreshEventTypes();
    setNewTypeName('');
    setAddTypeMode(false);
  }

  function seekToEvent(ts: number) {
    const p = localPlayerRef.current;
    if (!p) return;
    p.currentTime(ts);
    p.play();
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // '#' starts jersey-number entry; digits are captured until Enter/Esc
      // instead of acting as tag hotkeys.
      if (numberEntry !== null) {
        e.preventDefault();
        if (/^[0-9]$/.test(e.key)) setNumberEntry((v) => ((v ?? '') + e.key).slice(-2));
        else if (e.key === 'Backspace') setNumberEntry((v) => (v ?? '').slice(0, -1));
        else if (e.key === 'Enter') commitNumberEntry();
        else if (e.key === 'Escape') setNumberEntry(null);
        return;
      }
      if (e.key === '#') {
        e.preventDefault();
        setNumberEntry('');
        return;
      }
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        updateCapture({ team: capture.team === 'us' ? 'them' : 'us' });
        return;
      }

      // Cmd/Ctrl+Z as well as bare Z
      if (e.key.toLowerCase() === 'z' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          return;
        case 'j':
        case 'J':
          e.preventDefault();
          stepRate(-1);
          return;
        case 'l':
        case 'L':
          e.preventDefault();
          stepRate(1);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          seek(e.shiftKey ? -10 : -5);
          return;
        case 'ArrowRight':
          e.preventDefault();
          seek(e.shiftKey ? 10 : 5);
          return;
        case ',':
          e.preventDefault();
          frameBack();
          return;
        case '.':
          e.preventDefault();
          frameFwd();
          return;
        case '[':
          e.preventDefault();
          prevEvent();
          return;
        case ']':
          e.preventDefault();
          nextEvent();
          return;
        case '-':
          e.preventDefault();
          retimeLastTag(-RETIME_STEP);
          return;
        case '=':
        case '+':
          e.preventDefault();
          retimeLastTag(RETIME_STEP);
          return;
        case '?':
          e.preventDefault();
          setHelpOpen((v) => !v);
          return;
        case 'Escape':
          if (helpOpen) setHelpOpen(false);
          else if (lastTagId !== null) setLastTagId(null);
          else exitReviewMode();
          return;
      }

      const idx = tagIndexForKey(e);
      if (idx !== -1 && idx < eventTypes.length) {
        e.preventDefault();
        tagEvent(eventTypes[idx].id);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    togglePlay, stepRate, seek, frameBack, frameFwd, prevEvent, nextEvent, retimeLastTag,
    undo, tagEvent, eventTypes, helpOpen, lastTagId, exitReviewMode,
    numberEntry, capture, players, lastTag,
  ]);

  if (!reviewVideo) return null;

  const gameName = reviewVideo.file_path.replace(/^\d+_/, '');
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const shownTime = scrubTime ?? currentTime;
  // The event the playhead most recently passed, highlighted in the list.
  const currentEventId = [...sortedEvents].reverse().find((ev) => ev.timestamp <= currentTime + 0.05)?.id;
  const zones = computeZones(events, eventTypes, duration);
  const totals = zoneTotals(zones);
  const typeCounts = new Map<number, number>();
  events.forEach((ev) => typeCounts.set(ev.event_type_id, (typeCounts.get(ev.event_type_id) ?? 0) + 1));

  return (
    <div className="rt-mode">
      {/* Minimal header bar */}
      <div className="rt-header">
        <button className="rt-exit-btn" onClick={exitReviewMode} aria-label="Back to library">
          <BackIcon size={18} />
          <span className="rt-exit-label">Back</span>
        </button>
        <div className="rt-game-title">
          <span className="rt-game-name">{gameName}</span>
          {reviewVideo.game_date && (
            <span className="rt-game-date">{reviewVideo.game_date}</span>
          )}
          {reviewVideo.competition_name && (
            <span className="rt-game-comp">{reviewVideo.competition_name}</span>
          )}
        </div>
        <button
          className="rt-header-btn"
          onClick={cyclePreRoll}
          title="Seconds subtracted from the playhead when you tag, to cover reaction time"
        >
          <span className="rt-header-btn-label">Pre-roll</span>
          <span className="rt-mono">{preRoll === 0 ? 'off' : `−${preRoll}s`}</span>
        </button>
        <button
          className="rt-header-btn rt-help-btn"
          onClick={() => setHelpOpen((v) => !v)}
          aria-label="Keyboard shortcuts"
          aria-expanded={helpOpen}
        >
          ?
        </button>
        <button
          className={`rt-panel-toggle${eventsOpen ? ' active' : ''}`}
          onClick={() => setEventsOpen((v) => !v)}
          aria-label={eventsOpen ? 'Hide events panel' : 'Show events panel'}
        >
          {eventsOpen ? 'Hide Events' : `Events (${events.length})`}
        </button>
      </div>

      {/* Body: video column + collapsible events panel */}
      <div className="rt-body">
        {/* Main column: video + controls + tag strip */}
        <div className="rt-main-col">
          {/* Video area - video.js renders here, no native controls */}
          <div className="rt-video-wrap">
            <VideoPlayer playerRef={localPlayerRef} onReady={handlePlayerReady} />
            {toast && (
              <div className={`rt-toast rt-toast-${toast.tone}`} role="status">
                {toast.text}
              </div>
            )}
          </div>

          {/* Slim controls bar */}
          <div className="rt-controls-bar">
            {/* Seek bar with event markers */}
            <div className="rt-seek-row">
              <span className="rt-time">{formatTime(shownTime)}</span>
              <div
                className="rt-seek-track"
                onPointerMove={(e) => {
                  if (e.pointerType !== 'mouse' || !duration) return;
                  // Thumb centre travels 11px in from each edge (22px thumb)
                  const r = e.currentTarget.getBoundingClientRect();
                  const frac = (e.clientX - r.left - 11) / (r.width - 22);
                  setHoverTime(Math.max(0, Math.min(1, frac)) * duration);
                }}
                onPointerLeave={() => setHoverTime(null)}
              >
                {duration > 0 && (
                  <div className="rt-seek-markers">
                    <SeekPreview
                      videoId={reviewVideo.id}
                      status={thumbs}
                      time={scrubTime ?? hoverTime}
                      duration={duration}
                    />
                    {zones.map((z) => (
                      <span
                        key={`${z.zone}-${z.start}`}
                        className={`rt-zone rt-zone-${z.zone}`}
                        style={{
                          left: `${(z.start / duration) * 100}%`,
                          width: `${((z.end - z.start) / duration) * 100}%`,
                        }}
                      />
                    ))}
                    {sortedEvents.map((ev) => (
                      <span
                        key={ev.id}
                        className={`rt-seek-marker${ev.team ? ` team-${ev.team}` : ''}${ev.id === lastTagId ? ' last' : ''}`}
                        style={{ left: `${(ev.timestamp / duration) * 100}%` }}
                      />
                    ))}
                  </div>
                )}
                <input
                  type="range"
                  className="rt-seekbar"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={shownTime}
                  // During drag: update the displayed position only (no seek).
                  // This prevents timeupdate from fighting the drag position and
                  // avoids triggering a Range request on every pixel of movement.
                  onChange={(e) => setScrubTime(parseFloat(e.target.value))}
                  // Commit on release (pointer) or key-up (Home/End/PageUp etc.).
                  onPointerUp={commitScrub}
                  onKeyUp={commitScrub}
                  onBlur={commitScrub}
                  aria-label="Seek"
                />
              </div>
              <span className="rt-time">{formatTime(duration)}</span>
            </div>

            {/* Transport row */}
            <div className="rt-transport-row">
              <button className="rt-tbtn rt-tbtn-nav" onClick={prevEvent} title="Previous event ([)" aria-label="Previous event">
                <PrevEventIcon size={18} />
              </button>
              <button className="rt-tbtn" onClick={() => seek(-10)} title="Back 10s (Shift+←)">
                -10s
              </button>
              <button className="rt-tbtn" onClick={() => seek(-5)} title="Back 5s (←)">
                -5s
              </button>
              <button className="rt-tbtn" onClick={frameBack} title="One frame back (,)">
                -1f
              </button>
              <button
                className="rt-tbtn rt-tbtn-play"
                onClick={togglePlay}
                title="Play / Pause (Space or K)"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
              </button>
              <button className="rt-tbtn" onClick={frameFwd} title="One frame forward (.)">
                +1f
              </button>
              <button className="rt-tbtn" onClick={() => seek(5)} title="Forward 5s (→)">
                +5s
              </button>
              <button className="rt-tbtn" onClick={() => seek(10)} title="Forward 10s (Shift+→)">
                +10s
              </button>
              <button className="rt-tbtn rt-tbtn-nav" onClick={nextEvent} title="Next event (])" aria-label="Next event">
                <NextEventIcon size={18} />
              </button>
              <div className="rt-speed-group" title="Speed (J / L)">
                <span className="rt-speed-label">Speed</span>
                {SPEEDS.map((r) => (
                  <button
                    key={r}
                    className={`rt-speed-btn${speed === r ? ' active' : ''}`}
                    onClick={() => setRate(r)}
                    aria-pressed={speed === r}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Inline player attach for the last tag - non-modal, video keeps playing */}
          {lastTag && (
            <div className="rt-attach-strip">
              <div className="rt-attach-head">
                <span className="rt-attach-label">Last tag</span>
                <span className="rt-attach-event">
                  {lastTag.event_type_name}
                  {' · '}<span className="rt-mono">{formatTime(lastTag.timestamp)}</span>
                </span>
                <div className="rt-segmented rt-segmented-sm" role="group" aria-label="Team on last tag">
                  {(['us', 'them'] as Team[]).map((t) => (
                    <button
                      key={t}
                      className={`rt-seg-btn team-${t}${lastTag.team === t ? ' active' : ''}`}
                      onClick={() => setLastTagTeam(t)}
                      aria-pressed={lastTag.team === t}
                    >
                      {t === 'us' ? 'Us' : 'Them'}
                    </button>
                  ))}
                </div>
                <div className="rt-segmented rt-segmented-sm" role="group" aria-label="Period on last tag">
                  {PERIODS.map((p) => (
                    <button
                      key={p}
                      className={`rt-seg-btn${lastTag.period === p ? ' active' : ''}`}
                      onClick={() => setLastTagPeriod(p)}
                      aria-pressed={lastTag.period === p}
                      title="Change period (later tags in the same period follow)"
                    >
                      {periodLabel(p)}
                    </button>
                  ))}
                </div>
                {numberEntry !== null && (
                  <span className="rt-number-entry" role="status">
                    #{numberEntry}<span className="rt-caret" /> <span className="rt-number-hint">Enter to add · Esc</span>
                  </span>
                )}
                <div className="rt-attach-actions">
                  <button className="rt-mini-btn" onClick={() => retimeLastTag(-RETIME_STEP)} title="Move tag 0.5s earlier (-)">
                    −0.5s
                  </button>
                  <button className="rt-mini-btn" onClick={() => retimeLastTag(RETIME_STEP)} title="Move tag 0.5s later (=)">
                    +0.5s
                  </button>
                  <button className="rt-mini-btn" onClick={undo} title="Undo (Z)">
                    <UndoIcon size={16} /> Undo <kbd className="rt-kbd">Z</kbd>
                  </button>
                  <button className="rt-mini-btn" onClick={() => setLastTagId(null)} aria-label="Close player strip (Esc)">
                    <CloseIcon size={16} />
                  </button>
                </div>
              </div>
              {isShot(eventTypes, lastTag.event_type_id) && (
                <ShotDetailsEditor value={lastTag} team={lastTag.team} onChange={updateLastTagShot} compact />
              )}
              {players.length === 0 ? (
                <p className="rt-attach-empty">No players in roster yet.</p>
              ) : (
                <div className="rt-attach-players" role="group" aria-label="Players on this event">
                  {players.map((p) => {
                    const on = lastTag.players.some((lp) => lp.id === p.id);
                    return (
                      <button
                        key={p.id}
                        className={`rt-picker-btn${on ? ' selected' : ''}`}
                        onClick={() => toggleLastTagPlayer(p.id)}
                        aria-pressed={on}
                      >
                        {playerLabel(p)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tag pad - every type visible, hotkey on each button */}
          <div className="rt-tag-strip">
            <div className="rt-capture-bar">
              <div className="rt-segmented" role="group" aria-label="Team for new tags (Tab)">
                {(['us', 'them'] as Team[]).map((t) => (
                  <button
                    key={t}
                    className={`rt-seg-btn rt-seg-team team-${t}${capture.team === t ? ' active' : ''}`}
                    onClick={() => updateCapture({ team: t })}
                    aria-pressed={capture.team === t}
                    title="Team that made the play (Tab to switch)"
                  >
                    {t === 'us' ? 'Us' : 'Them'}
                  </button>
                ))}
              </div>
              <div className="rt-segmented" role="group" aria-label="Period">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    className={`rt-seg-btn${capture.period === p ? ' active' : ''}`}
                    onClick={() => updateCapture({ period: p })}
                    aria-pressed={capture.period === p}
                  >
                    {periodLabel(p)}
                  </button>
                ))}
              </div>
              <div className="rt-segmented" role="group" aria-label="Strength">
                {(['EV', 'PP', 'PK'] as Strength[]).map((st) => (
                  <button
                    key={st}
                    className={`rt-seg-btn${capture.strength === st ? ' active' : ''}`}
                    onClick={() => updateCapture({ strength: st })}
                    aria-pressed={capture.strength === st}
                  >
                    {st}
                  </button>
                ))}
              </div>
              <kbd className="rt-kbd rt-capture-hint">Tab</kbd>
            </div>
            <div className="rt-tag-grid">
              {eventTypes.map((et, idx) => (
                <button
                  key={et.id}
                  className={`rt-tag-btn${et.is_custom ? ' custom' : ''}`}
                  onClick={() => tagEvent(et.id)}
                  aria-label={`Tag ${et.name}`}
                  aria-keyshortcuts={idx < TAG_KEYS.length ? TAG_KEYS[idx] : undefined}
                >
                  {idx < TAG_KEYS.length && <kbd className="rt-kbd">{TAG_KEYS[idx]}</kbd>}
                  <span className="rt-tag-name">{et.name}</span>
                  <span className="rt-tag-count">{typeCounts.get(et.id) ?? 0}</span>
                </button>
              ))}
              {addTypeMode ? (
                <div className="rt-add-type-inline">
                  <input
                    className="rt-add-type-input"
                    placeholder="Event name"
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addCustomType();
                      if (e.key === 'Escape') setAddTypeMode(false);
                    }}
                    autoFocus
                    aria-label="New event type name"
                  />
                  <button className="rt-add-type-confirm" onClick={addCustomType}>
                    Add
                  </button>
                  <button className="rt-add-type-cancel" onClick={() => setAddTypeMode(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="rt-tag-btn rt-tag-btn-add"
                  onClick={() => setAddTypeMode(true)}
                  aria-label="Add custom event type"
                >
                  + Custom
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible events panel */}
        {eventsOpen && (
          <div className="rt-events-panel">
            <div className="rt-events-header">
              <span>Tagged ({events.length})</span>
              <button
                className="rt-events-close"
                onClick={() => setEventsOpen(false)}
                aria-label="Hide events panel"
              >
                <CloseIcon size={16} />
              </button>
            </div>
            {zones.length > 0 && (
              <div className="rt-zone-totals" title="Time in each zone, worked out from your tags">
                <span><span className="rt-zone-key rt-zone-oz" />OZ {formatTime(totals.oz)}</span>
                <span><span className="rt-zone-key rt-zone-nz" />NZ {formatTime(totals.nz)}</span>
                <span><span className="rt-zone-key rt-zone-dz" />DZ {formatTime(totals.dz)}</span>
              </div>
            )}
            <div className="rt-events-list">
              {sortedEvents.length === 0 ? (
                <div className="rt-events-empty">
                  Tap a tag button or press its key to create events.
                </div>
              ) : (
                sortedEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className={`rt-event-row${ev.id === currentEventId ? ' current' : ''}${ev.id === lastTagId ? ' last' : ''}`}
                  >
                    <button
                      className="rt-event-item"
                      onClick={() => seekToEvent(ev.timestamp)}
                      aria-label={`${ev.event_type_name} at ${formatTime(ev.timestamp)}`}
                    >
                      <span className={`rt-ev-team${ev.team ? ` team-${ev.team}` : ''}`} aria-label={ev.team ?? 'no team'} />
                      <span className="rt-ev-ts">{formatTime(ev.timestamp)}</span>
                      <span className="rt-ev-type">{ev.event_type_name}</span>
                      {ev.period !== null && <span className="rt-ev-period">{periodLabel(ev.period)}</span>}
                      {ev.players.length > 0 && (
                        <span className="rt-ev-players">
                          {ev.players.map(playerLabel).join(', ')}
                        </span>
                      )}
                    </button>
                    <button
                      className="rt-ev-action"
                      onClick={() => setLastTagId(ev.id)}
                      aria-label={`Edit players on ${ev.event_type_name} at ${formatTime(ev.timestamp)}`}
                      title="Edit players, team, period, time"
                    >
                      Edit
                    </button>
                    <button
                      className="rt-ev-action rt-ev-delete"
                      onClick={() => deleteEvent(ev)}
                      aria-label={`Delete ${ev.event_type_name} at ${formatTime(ev.timestamp)}`}
                      title="Delete (Z to undo)"
                    >
                      <CloseIcon size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Keyboard cheat sheet */}
      {helpOpen && (
        <div
          className="rt-help-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setHelpOpen(false); }}
        >
          <div className="rt-help-card" role="dialog" aria-label="Keyboard shortcuts">
            <div className="rt-help-head">
              <span>Keyboard shortcuts</span>
              <button className="rt-events-close" onClick={() => setHelpOpen(false)} aria-label="Close">
                <CloseIcon size={16} />
              </button>
            </div>
            <dl className="rt-help-list">
              {SHORTCUT_HELP.map(([keys, desc]) => (
                <div key={keys} className="rt-help-row">
                  <dt><kbd className="rt-kbd">{keys}</kbd></dt>
                  <dd>{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
