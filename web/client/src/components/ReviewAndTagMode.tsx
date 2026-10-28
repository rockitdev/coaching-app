import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../App';
import * as api from '../api/client';
import type { GameEvent, Player } from '../types';
import VideoPlayer from './VideoPlayer';
import type VjsPlayer from 'video.js/dist/types/player';
import './ReviewAndTagMode.css';

const FRAME_SEC = 1 / 30;
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2];

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function clamp(t: number, dur: number) {
  return Math.max(0, Math.min(t, dur || 0));
}

// ---------------------------------------------------------------------------
// Player quick-pick popover shown right after tagging an event
// ---------------------------------------------------------------------------
interface PlayerPickerProps {
  eventId: number;
  players: Player[];
  onClose: () => void;
}

function PlayerPicker({ eventId, players, onClose }: PlayerPickerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      if (selectedIds.size > 0) {
        await api.updateEventPlayers(eventId, Array.from(selectedIds));
      }
    } finally {
      onClose();
    }
  }

  return (
    <div className="rt-picker-card">
      <div className="rt-picker-header">
        <span className="rt-picker-title">Tag players (optional)</span>
        <button className="rt-picker-skip" onClick={onClose}>
          Skip
        </button>
      </div>
      {players.length === 0 ? (
        <p className="rt-picker-empty">No players in roster yet.</p>
      ) : (
        <div className="rt-picker-grid">
          {players.map((p) => (
            <button
              key={p.id}
              className={`rt-picker-btn${selectedIds.has(p.id) ? ' selected' : ''}`}
              onClick={() => toggle(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="rt-picker-actions">
        <button className="rt-action-btn rt-action-btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Done'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Review & Tag mode
// ---------------------------------------------------------------------------
export default function ReviewAndTagMode() {
  const { players, eventTypes, reviewVideo, exitReviewMode, refreshEventTypes } = useApp();

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
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [eventsOpen, setEventsOpen] = useState(true);
  const [pickerEventId, setPickerEventId] = useState<number | null>(null);
  const [addTypeMode, setAddTypeMode] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  const loadEvents = useCallback(async () => {
    if (!reviewVideo) return;
    const evs = await api.getVideoEvents(reviewVideo.id).catch(() => []);
    setEvents(evs);
  }, [reviewVideo]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Handle player ready: set source and hide video.js native controls
  function handlePlayerReady(player: VjsPlayer) {
    if (reviewVideo) {
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
      // WebKit first-frame fix: with preload='metadata' the browser loads just
      // enough to know the duration but may not decode even one frame, leaving
      // the player area black until the user scrubs or presses play.  Seeking
      // to a tiny positive offset (0.001 s) forces the decoder to fetch and
      // render the first frame immediately so the viewer sees a poster frame
      // rather than a black rectangle.  We only do this when paused (no seek
      // storm during active playback) and only when at position 0 (first open).
      if (player.paused() && (player.currentTime() ?? 0) < 0.01) {
        player.currentTime(0.001);
      }
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

  // Tag an event at current timestamp - the core interaction
  async function tagEvent(eventTypeId: number) {
    const p = localPlayerRef.current;
    if (!reviewVideo || !p) return;
    const timestamp = p.currentTime() ?? 0;
    try {
      const result = await api.addEvent(reviewVideo.id, eventTypeId, timestamp);
      // Refresh events list immediately (don't wait for picker close)
      await loadEvents();
      // Show quick player-pick popover
      setPickerEventId(result.id);
    } catch (e) {
      console.error('Failed to tag event:', e);
    }
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
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if ((e.target as HTMLElement).isContentEditable) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(e.shiftKey ? -10 : -5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(e.shiftKey ? 10 : 5);
          break;
        case ',':
          e.preventDefault();
          frameBack();
          break;
        case '.':
          e.preventDefault();
          frameFwd();
          break;
        case '[':
          e.preventDefault();
          prevEvent();
          break;
        case ']':
          e.preventDefault();
          nextEvent();
          break;
        case 'Escape':
          if (pickerEventId !== null) {
            setPickerEventId(null);
            loadEvents();
          } else {
            exitReviewMode();
          }
          break;
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [togglePlay, seek, frameBack, frameFwd, prevEvent, nextEvent, exitReviewMode, pickerEventId, loadEvents]);

  if (!reviewVideo) return null;

  const gameName = reviewVideo.file_path.replace(/^\d+_/, '');
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className="rt-mode">
      {/* Minimal header bar */}
      <div className="rt-header">
        <button className="rt-exit-btn" onClick={exitReviewMode} aria-label="Back to library">
          <span className="rt-exit-arrow">&#8592;</span>
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
          </div>

          {/* Slim controls bar */}
          <div className="rt-controls-bar">
            {/* Single seek bar */}
            <div className="rt-seek-row">
              <span className="rt-time">{formatTime(scrubTime ?? currentTime)}</span>
              <input
                type="range"
                className="rt-seekbar"
                min={0}
                max={duration || 0}
                step={0.1}
                value={scrubTime ?? currentTime}
                // During drag: update the displayed position only (no seek).
                // This prevents timeupdate from fighting the drag position and
                // avoids triggering a Range request on every pixel of movement.
                onChange={(e) => setScrubTime(parseFloat(e.target.value))}
                // On release: commit the seek and clear the scrub position.
                onPointerUp={(e) => {
                  const t = parseFloat((e.target as HTMLInputElement).value);
                  seekTo(t);
                  setScrubTime(null);
                }}
                aria-label="Seek"
              />
              <span className="rt-time">{formatTime(duration)}</span>
            </div>

            {/* Transport row */}
            <div className="rt-transport-row">
              <button
                className="rt-tbtn rt-tbtn-nav"
                onClick={prevEvent}
                title="Previous event [["
                aria-label="Previous event"
              >
                &#9664;&#9664;
              </button>
              <button className="rt-tbtn" onClick={() => seek(-10)} title="Back 10s">
                -10s
              </button>
              <button className="rt-tbtn" onClick={() => seek(-5)} title="Back 5s">
                -5s
              </button>
              <button className="rt-tbtn" onClick={frameBack} title="One frame back (,)">
                &#9664;1f
              </button>
              <button
                className="rt-tbtn rt-tbtn-play"
                onClick={togglePlay}
                title="Play / Pause (Space)"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button className="rt-tbtn" onClick={frameFwd} title="One frame forward (.)">
                1f&#9654;
              </button>
              <button className="rt-tbtn" onClick={() => seek(5)} title="Forward 5s">
                +5s
              </button>
              <button className="rt-tbtn" onClick={() => seek(10)} title="Forward 10s">
                +10s
              </button>
              <button
                className="rt-tbtn rt-tbtn-nav"
                onClick={nextEvent}
                title="Next event ]]"
                aria-label="Next event"
              >
                &#9654;&#9654;
              </button>
              <div className="rt-speed-group">
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

          {/* Tag strip - always visible, thumb-reachable, scrollable */}
          <div className="rt-tag-strip">
            <div className="rt-tag-scroll">
              {eventTypes.map((et) => (
                <button
                  key={et.id}
                  className={`rt-tag-btn${et.is_custom ? ' custom' : ''}`}
                  onClick={() => tagEvent(et.id)}
                  aria-label={`Tag ${et.name}`}
                >
                  {et.name}
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
                &#10005;
              </button>
            </div>
            <div className="rt-events-list">
              {sortedEvents.length === 0 ? (
                <div className="rt-events-empty">
                  Tap a tag button to create events.
                </div>
              ) : (
                sortedEvents.map((ev) => (
                  <button
                    key={ev.id}
                    className="rt-event-item"
                    onClick={() => seekToEvent(ev.timestamp)}
                    aria-label={`${ev.event_type_name} at ${formatTime(ev.timestamp)}`}
                  >
                    <span className="rt-ev-ts">{formatTime(ev.timestamp)}</span>
                    <span className="rt-ev-type">{ev.event_type_name}</span>
                    {ev.players.length > 0 && (
                      <span className="rt-ev-players">
                        {ev.players.map((p) => p.name).join(', ')}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Player quick-pick overlay - shown right after tagging */}
      {pickerEventId !== null && (
        <div
          className="rt-picker-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPickerEventId(null);
              loadEvents();
            }
          }}
        >
          <PlayerPicker
            eventId={pickerEventId}
            players={players}
            onClose={() => {
              setPickerEventId(null);
              loadEvents();
            }}
          />
        </div>
      )}
    </div>
  );
}
