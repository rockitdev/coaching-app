import { useState, useEffect, useCallback } from 'react';
import type VjsPlayer from 'video.js/dist/types/player';
import type { GameEvent } from '../types';
import './FilmControls.css';

const FRAME_RATE = 30;
const FRAME_SEC = 1 / FRAME_RATE;
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2];

interface Props {
  player: VjsPlayer | null;
  events: GameEvent[];
  visible: boolean;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function clamp(t: number, dur: number) {
  return Math.max(0, Math.min(t, dur || 0));
}

export default function FilmControls({ player, events, visible }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  // Sync state from player events
  useEffect(() => {
    if (!player) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(player.currentTime() ?? 0);
    const onLoadedMeta = () => {
      setDuration(player.duration() ?? 0);
      setCurrentTime(0);
    };
    const onRateChange = () => setSpeed(player.playbackRate() ?? 1);

    player.on('play', onPlay);
    player.on('pause', onPause);
    player.on('timeupdate', onTimeUpdate);
    player.on('loadedmetadata', onLoadedMeta);
    player.on('ratechange', onRateChange);

    return () => {
      if (!player.isDisposed()) {
        player.off('play', onPlay);
        player.off('pause', onPause);
        player.off('timeupdate', onTimeUpdate);
        player.off('loadedmetadata', onLoadedMeta);
        player.off('ratechange', onRateChange);
      }
    };
  }, [player]);

  const seek = useCallback(
    (offset: number) => {
      if (!player) return;
      player.currentTime(clamp((player.currentTime() ?? 0) + offset, player.duration() ?? 0));
    },
    [player]
  );

  const seekTo = useCallback(
    (t: number) => {
      if (!player) return;
      player.currentTime(clamp(t, player.duration() ?? 0));
    },
    [player]
  );

  const togglePlay = useCallback(() => {
    if (!player) return;
    if (player.paused()) player.play();
    else player.pause();
  }, [player]);

  const frameBack = useCallback(() => {
    if (!player) return;
    player.pause();
    player.currentTime(clamp((player.currentTime() ?? 0) - FRAME_SEC, player.duration() ?? 0));
  }, [player]);

  const frameFwd = useCallback(() => {
    if (!player) return;
    player.pause();
    player.currentTime(clamp((player.currentTime() ?? 0) + FRAME_SEC, player.duration() ?? 0));
  }, [player]);

  const replay10 = useCallback(() => {
    if (!player) return;
    player.currentTime(clamp((player.currentTime() ?? 0) - 10, player.duration() ?? 0));
    player.play();
  }, [player]);

  const prevEvent = useCallback(() => {
    if (!player) return;
    const t = player.currentTime() ?? 0;
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const prev = [...sorted].reverse().find((ev) => ev.timestamp < t - 0.1);
    if (prev) player.currentTime(prev.timestamp);
  }, [player, events]);

  const nextEvent = useCallback(() => {
    if (!player) return;
    const t = player.currentTime() ?? 0;
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const next = sorted.find((ev) => ev.timestamp > t + 0.1);
    if (next) player.currentTime(next.timestamp);
  }, [player, events]);

  const setRate = useCallback(
    (rate: number) => {
      if (!player) return;
      player.playbackRate(rate);
      setSpeed(rate);
    },
    [player]
  );

  const onSeekBarChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = parseFloat(e.target.value);
      seekTo(t);
    },
    [seekTo]
  );

  if (!visible) return null;

  return (
    <div className="film-controls">
      {/* Seek bar */}
      <div className="film-seek-row">
        <span className="film-time-small">{formatTime(currentTime)}</span>
        <input
          type="range"
          className="film-seekbar"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={onSeekBarChange}
          aria-label="Seek"
        />
        <span className="film-time-small">{formatTime(duration)}</span>
      </div>

      {/* Main controls row */}
      <div className="film-row film-row-main">
        <button className="film-btn film-btn-nav" onClick={prevEvent} title="Previous tagged event">
          ◀◀ Prev
        </button>
        <button className="film-btn film-btn-skip" onClick={() => seek(-10)} title="Back 10s">
          −10s
        </button>
        <button className="film-btn film-btn-skip" onClick={() => seek(-5)} title="Back 5s">
          −5s
        </button>
        <button className="film-btn film-btn-frame" onClick={frameBack} title="One frame back">
          ◀ 1f
        </button>
        <button className="film-btn film-btn-play" onClick={togglePlay} title="Play / Pause">
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button className="film-btn film-btn-frame" onClick={frameFwd} title="One frame forward">
          1f ▶
        </button>
        <button className="film-btn film-btn-skip" onClick={() => seek(5)} title="Forward 5s">
          +5s
        </button>
        <button className="film-btn film-btn-skip" onClick={() => seek(10)} title="Forward 10s">
          +10s
        </button>
        <button className="film-btn film-btn-nav" onClick={nextEvent} title="Next tagged event">
          Next ▶▶
        </button>
      </div>

      {/* Secondary row: replay + speed */}
      <div className="film-row film-row-secondary">
        <button className="film-btn film-btn-replay" onClick={replay10} title="Replay last 10s">
          ↺ 10s
        </button>
        <div className="film-speed-group">
          <span className="film-speed-label">Speed:</span>
          {SPEEDS.map((r) => (
            <button
              key={r}
              className={`film-speed-btn${speed === r ? ' active' : ''}`}
              onClick={() => setRate(r)}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
