import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';
import * as api from '../api/client';
import type { Video, GameEvent } from '../types';
import VideoPlayer from './VideoPlayer';
import FilmControls from './FilmControls';
import UploadModal from './UploadModal';
import GameInfoModal from './GameInfoModal';
import EventEditModal from './EventEditModal';
import CompetitionsModal from './CompetitionsModal';
import GenericModal from './GenericModal';
import './VideoReview.css';

const SHORTCUT_KEYS = [
  '1','2','3','4','5','6','7','8','9','0',
  'Q','W','E','R','T','Y','U','I','O','P',
];

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Props {
  isActive: boolean;
}

export default function VideoReview({ isActive }: Props) {
  const {
    players,
    eventTypes,
    competitions,
    currentVideo,
    currentVideoEvents,
    playerRef,
    refreshEventTypes,
    refreshCompetitions,
    openVideo,
    setCurrentVideoEvents,
    enterReviewMode,
  } = useApp();

  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<number>>(new Set());
  const [playerLoaded, setPlayerLoaded] = useState(false);

  // Modal states
  const [uploadOpen, setUploadOpen] = useState(false);
  const [gameInfoOpen, setGameInfoOpen] = useState(false);
  const [competitionsOpen, setCompetitionsOpen] = useState(false);
  const [editEventOpen, setEditEventOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<GameEvent | null>(null);
  const [addEventTypeOpen, setAddEventTypeOpen] = useState(false);

  const loadVideos = useCallback(async () => {
    const vids = await api.getVideos().catch(() => []);
    setVideos(vids);
  }, []);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  const loadVideoEvents = useCallback(async (videoId: number) => {
    const events = await api.getVideoEvents(videoId).catch(() => []);
    setCurrentVideoEvents(events);
  }, [setCurrentVideoEvents]);

  useEffect(() => {
    if (currentVideo) {
      loadVideoEvents(currentVideo.id);
    }
  }, [currentVideo, loadVideoEvents]);

  // Set video source when currentVideo changes
  useEffect(() => {
    if (!currentVideo || !playerRef.current) return;
    playerRef.current.src({
      src: `/videos/${currentVideo.file_path}`,
      type: 'video/mp4',
    });
  }, [currentVideo, playerRef]);

  // Listen for hc-seek-to events from PlayerManagement
  useEffect(() => {
    function handleSeekTo(e: Event) {
      const { timestamp, videoId } = (e as CustomEvent<{ timestamp: number; videoId: number }>).detail;
      const p = playerRef.current;
      if (!p) return;
      // If the right video is already loaded, seek immediately
      const clamp = (t: number) => Math.max(0, Math.min(t, p.duration() ?? 0));
      if (currentVideo?.id === videoId && p.duration()) {
        p.currentTime(clamp(timestamp));
        p.play();
      } else {
        // Wait for metadata to load, then seek
        p.one('loadedmetadata', () => {
          p.currentTime(clamp(timestamp));
          p.play();
        });
      }
    }
    window.addEventListener('hc-seek-to', handleSeekTo);
    return () => window.removeEventListener('hc-seek-to', handleSeekTo);
  }, [currentVideo, playerRef]);

  function handleVideoSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const videoId = parseInt(e.target.value, 10);
    if (!videoId) return;
    const video = videos.find((v) => v.id === videoId);
    if (video) {
      openVideo(video);
      setSelectedVideoId(e.target.value);
    }
  }

  async function handleUploaded(video: Video) {
    const comp = competitions.find((c) => c.id === video.competition_id);
    const enriched: Video = { ...video, competition_name: comp?.name ?? null };
    await loadVideos();
    openVideo(enriched);
    setSelectedVideoId(String(video.id));
  }

  async function handleGameInfoSaved(updated: Video) {
    setCurrentVideoEvents([]); // keep state clean
    openVideo(updated);
    await loadVideos();
  }

  async function tagEvent(eventTypeId: number) {
    if (!currentVideo || !playerRef.current) {
      alert('Please load a video first');
      return;
    }
    const timestamp = playerRef.current.currentTime() ?? 0;
    try {
      const eventResult = await api.addEvent(currentVideo.id, eventTypeId, timestamp);
      for (const pid of Array.from(selectedPlayerIds)) {
        await api.addEventPlayerAssociation(eventResult.id, pid);
      }
      await loadVideoEvents(currentVideo.id);
    } catch (e) {
      alert('Failed to tag event: ' + (e as Error).message);
    }
  }

  function togglePlayerSelect(pid: number) {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  function openEventEdit(event: GameEvent) {
    setEditingEvent(event);
    setEditEventOpen(true);
  }

  function seekToEvent(ts: number) {
    if (!playerRef.current) return;
    playerRef.current.currentTime(ts);
    playerRef.current.play();
  }

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;

    function handleKey(e: KeyboardEvent) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if ((e.target as HTMLElement).isContentEditable) return;

      const p = playerRef.current;
      if (!p || !currentVideo) return;

      const clamp = (t: number) => Math.max(0, Math.min(t, p.duration() ?? 0));

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (p.paused()) p.play(); else p.pause();
          return;
        case 'ArrowLeft':
          e.preventDefault();
          p.currentTime(clamp((p.currentTime() ?? 0) - (e.shiftKey ? 10 : 5)));
          return;
        case 'ArrowRight':
          e.preventDefault();
          p.currentTime(clamp((p.currentTime() ?? 0) + (e.shiftKey ? 10 : 5)));
          return;
        case ',':
          e.preventDefault();
          p.pause();
          p.currentTime(clamp((p.currentTime() ?? 0) - 1/30));
          return;
        case '.':
          e.preventDefault();
          p.pause();
          p.currentTime(clamp((p.currentTime() ?? 0) + 1/30));
          return;
        case '[': {
          e.preventDefault();
          const t = p.currentTime() ?? 0;
          const sorted = [...currentVideoEvents].sort((a, b) => a.timestamp - b.timestamp);
          const prev = [...sorted].reverse().find((ev) => ev.timestamp < t - 0.1);
          if (prev) p.currentTime(prev.timestamp);
          return;
        }
        case ']': {
          e.preventDefault();
          const t = p.currentTime() ?? 0;
          const sorted = [...currentVideoEvents].sort((a, b) => a.timestamp - b.timestamp);
          const next = sorted.find((ev) => ev.timestamp > t + 0.1);
          if (next) p.currentTime(next.timestamp);
          return;
        }
      }

      // Event tagging shortcuts
      const key = e.key.toUpperCase();
      const idx = SHORTCUT_KEYS.indexOf(key);
      if (idx !== -1 && idx < eventTypes.length) {
        tagEvent(eventTypes[idx].id);
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, currentVideo, currentVideoEvents, eventTypes, playerRef]);

  // Group videos by competition for the select
  const videoGroups = (() => {
    const groups = new Map<string, Video[]>();
    const noComp: Video[] = [];
    videos.forEach((v) => {
      if (v.competition_name) {
        if (!groups.has(v.competition_name)) groups.set(v.competition_name, []);
        groups.get(v.competition_name)!.push(v);
      } else {
        noComp.push(v);
      }
    });
    return { groups, noComp };
  })();

  return (
    <div className="video-review">
      {/* Top toolbar */}
      <div className="vr-toolbar">
        <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
          Upload Video
        </button>
        <select
          className="form-input vr-game-select"
          value={selectedVideoId}
          onChange={handleVideoSelect}
        >
          <option value="">-- select a game --</option>
          {Array.from(videoGroups.groups.entries()).map(([compName, vids]) => (
            <optgroup key={compName} label={compName}>
              {vids.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.file_path.replace(/^\d+_/, '')}
                  {v.game_date ? ` (${v.game_date})` : ''}
                </option>
              ))}
            </optgroup>
          ))}
          {videoGroups.noComp.length > 0 && (
            <optgroup label="Uncategorized">
              {videoGroups.noComp.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.file_path.replace(/^\d+_/, '')}
                  {v.game_date ? ` (${v.game_date})` : ''}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setCompetitionsOpen(true)}
        >
          Competitions
        </button>
      </div>

      {/* Game info bar */}
      {currentVideo && (
        <div className="game-info-bar">
          <span className="game-info-piece">
            {currentVideo.game_date ? `Date: ${currentVideo.game_date}` : 'No date set'}
          </span>
          <span className="game-info-piece">
            {currentVideo.competition_name
              ? `Competition: ${currentVideo.competition_name}`
              : 'No competition set'}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setGameInfoOpen(true)}
          >
            Edit Info
          </button>
          <button
            className="btn btn-primary btn-sm vr-review-btn"
            onClick={() => enterReviewMode(currentVideo)}
            title="Enter focused Review and Tag mode (full screen, iPad-optimised)"
          >
            Review &amp; Tag
          </button>
        </div>
      )}

      {/* Video player + film controls */}
      <div className="vr-player-wrap">
        <VideoPlayer
          playerRef={playerRef}
          onReady={() => setPlayerLoaded(true)}
        />
        <FilmControls
          player={playerRef.current}
          events={currentVideoEvents}
          visible={!!currentVideo}
        />
      </div>

      {/* Event tagging panel */}
      <div className="vr-bottom-panel">
        {/* Event type buttons */}
        <div className="vr-section">
          <div className="vr-section-header">
            <h2 className="vr-section-title">Tag Event</h2>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setAddEventTypeOpen(true)}
            >
              + Custom
            </button>
          </div>
          <div className="event-type-grid">
            {eventTypes.map((et, idx) => (
              <button
                key={et.id}
                className={`event-tag-btn${et.is_custom ? ' custom' : ''}`}
                onClick={() => tagEvent(et.id)}
                title={idx < SHORTCUT_KEYS.length ? `Press ${SHORTCUT_KEYS[idx]}` : undefined}
              >
                <span className="event-tag-name">{et.name}</span>
                {idx < SHORTCUT_KEYS.length && (
                  <span className="event-tag-shortcut">[{SHORTCUT_KEYS[idx]}]</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Player selection */}
        <div className="vr-section">
          <h2 className="vr-section-title">Players (optional)</h2>
          <div className="player-checkbox-grid">
            {players.map((p) => (
              <label key={p.id} className="player-checkbox-item">
                <input
                  type="checkbox"
                  checked={selectedPlayerIds.has(p.id)}
                  onChange={() => togglePlayerSelect(p.id)}
                />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Tagged events */}
        <div className="vr-section">
          <h2 className="vr-section-title">Tagged Events</h2>
          {currentVideoEvents.length === 0 ? (
            <div className="empty-msg">No events tagged yet</div>
          ) : (
            <div className="events-list">
              {currentVideoEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="event-item"
                  onClick={() => seekToEvent(ev.timestamp)}
                >
                  <span className="event-ts">{formatTime(ev.timestamp)}</span>
                  <span className="event-type-label">{ev.event_type_name}</span>
                  <span className="event-players-label">
                    {ev.players.map((p) => p.name).join(', ')}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm event-edit-btn"
                    onClick={(e) => { e.stopPropagation(); openEventEdit(ev); }}
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />
      <GameInfoModal
        open={gameInfoOpen}
        video={currentVideo}
        onClose={() => setGameInfoOpen(false)}
        onSaved={handleGameInfoSaved}
      />
      <CompetitionsModal
        open={competitionsOpen}
        onClose={async () => {
          setCompetitionsOpen(false);
          await refreshCompetitions();
          await loadVideos();
        }}
      />
      <EventEditModal
        open={editEventOpen}
        event={editingEvent}
        onClose={() => setEditEventOpen(false)}
        onSaved={() => currentVideo && loadVideoEvents(currentVideo.id)}
        onDeleted={() => currentVideo && loadVideoEvents(currentVideo.id)}
      />
      <GenericModal
        title="Add Custom Event Type"
        placeholder="Event type name (e.g. Breakout)"
        open={addEventTypeOpen}
        onClose={() => setAddEventTypeOpen(false)}
        onSave={async (name) => {
          await api.addEventType(name, true);
          await refreshEventTypes();
        }}
      />
    </div>
  );
}
