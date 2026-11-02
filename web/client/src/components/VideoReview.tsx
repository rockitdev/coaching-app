import { useState, useEffect, useCallback, useRef } from 'react';
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
import HighlightsModal from './HighlightsModal';
import TeamSwitch from './TeamSwitch';
import { TAG_KEYS, tagIndexForKey, isTypingTarget } from '../shortcuts';
import { bindResume } from '../session';
import { playerLabel } from '../hockey';
import './VideoReview.css';

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDate(d: string | null): string {
  if (!d) return '';
  // Try parsing as YYYY-MM-DD
  const parts = d.split('-');
  if (parts.length === 3) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const month = months[parseInt(parts[1], 10) - 1] ?? parts[1];
    return `${month} ${parseInt(parts[2], 10)}, ${parts[0]}`;
  }
  return d;
}

interface Props {
  isActive: boolean;
}

export default function VideoReview({ isActive }: Props) {
  const {
    currentTeamId,
    currentTeam,
    openTeamsModal,
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
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<number>>(new Set());
  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);

  // Modal states
  const [uploadOpen, setUploadOpen] = useState(false);
  const [gameInfoOpen, setGameInfoOpen] = useState(false);
  const [competitionsOpen, setCompetitionsOpen] = useState(false);
  const [editEventOpen, setEditEventOpen] = useState(false);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<GameEvent | null>(null);
  const [addEventTypeOpen, setAddEventTypeOpen] = useState(false);

  // The library shows one team's games at a time.
  const loadVideos = useCallback(async () => {
    if (currentTeamId === null) return;
    const vids = await api.getVideos(currentTeamId).catch(() => []);
    setVideos(vids);
  }, [currentTeamId]);

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

  // Latest video for the player's ready callback, which is bound once at mount.
  const currentVideoRef = useRef(currentVideo);
  currentVideoRef.current = currentVideo;

  // A freshly created player gets its source here rather than from the effect
  // below: in dev StrictMode the player is created, disposed and recreated, and
  // the effect only reaches the first (disposed) instance -- leaving the first
  // game opened with no source at all.
  function handlePlayerReady(p: NonNullable<typeof playerRef.current>) {
    setPlayerLoaded(true);
    // One player serves every game in the library, so resume looks up the
    // current game on each event.
    bindResume(p, () => currentVideoRef.current?.id ?? null);
    const v = currentVideoRef.current;
    const src = v ? `/videos/${v.file_path}` : null;
    if (src && !p.currentSrc().endsWith(src)) {
      p.src({ src, type: 'video/mp4' });
    }
  }

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
      const clamp = (t: number) => Math.max(0, Math.min(t, p.duration() ?? 0));
      if (currentVideo?.id === videoId && p.duration()) {
        p.currentTime(clamp(timestamp));
        p.play();
      } else {
        p.one('loadedmetadata', () => {
          p.currentTime(clamp(timestamp));
          p.play();
        });
      }
    }
    window.addEventListener('hc-seek-to', handleSeekTo);
    return () => window.removeEventListener('hc-seek-to', handleSeekTo);
  }, [currentVideo, playerRef]);

  function handleVideoClick(video: Video) {
    openVideo(video);
    // On narrow screens, close the library after selection to show the player
    if (window.innerWidth < 900) {
      setLibraryOpen(false);
    }
  }

  async function handleUploaded(video: Video) {
    const comp = competitions.find((c) => c.id === video.competition_id);
    const enriched: Video = { ...video, competition_name: comp?.name ?? null };
    await loadVideos();
    openVideo(enriched);
    if (window.innerWidth < 900) setLibraryOpen(false);
  }

  async function handleGameInfoSaved(updated: Video) {
    setCurrentVideoEvents([]);
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
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Leave the keyboard to any open dialog.
      if (document.querySelector('.modal-overlay')) return;

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

      const idx = tagIndexForKey(e);
      if (idx !== -1 && idx < eventTypes.length) {
        tagEvent(eventTypes[idx].id);
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, currentVideo, currentVideoEvents, eventTypes, playerRef]);

  // Group videos by competition for display
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

  const gameName = currentVideo
    ? currentVideo.file_path.replace(/^\d+_/, '')
    : null;

  return (
    <div className="video-review">
      {/* ---- Library sidebar (game list) ---- */}
      <aside className={`vr-library${libraryOpen ? ' open' : ''}`}>
        {/* Narrow screens only: the drawer covers the header's switcher */}
        <TeamSwitch className="vr-lib-team-switch" onManage={openTeamsModal} />
        <div className="vr-lib-header">
          <span className="vr-lib-heading">
            Library
            {currentTeam && <span className="vr-lib-team">{currentTeam.name}</span>}
          </span>
          <div className="vr-lib-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setCompetitionsOpen(true)}
              title="Manage competitions"
            >
              Competitions
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setUploadOpen(true)}
            >
              Upload
            </button>
          </div>
        </div>

        <div className="vr-lib-list">
          {videos.length === 0 && (
            <div className="vr-lib-empty">
              <span>No {currentTeam ? `${currentTeam.name} ` : ''}games yet.</span>
              <span>Upload a video to get started.</span>
            </div>
          )}

          {/* Competition groups */}
          {Array.from(videoGroups.groups.entries()).map(([compName, vids]) => (
            <div key={compName} className="vr-lib-group">
              <div className="vr-lib-group-label">{compName}</div>
              {vids.map((v) => (
                <button
                  key={v.id}
                  className={`vr-game-card${currentVideo?.id === v.id ? ' active' : ''}`}
                  onClick={() => handleVideoClick(v)}
                >
                  <span className="vr-game-card-name">
                    {v.file_path.replace(/^\d+_/, '')}
                  </span>
                  {v.game_date && (
                    <span className="vr-game-card-date">{formatDate(v.game_date)}</span>
                  )}
                </button>
              ))}
            </div>
          ))}

          {/* Uncategorized */}
          {videoGroups.noComp.length > 0 && (
            <div className="vr-lib-group">
              {videoGroups.groups.size > 0 && (
                <div className="vr-lib-group-label">Uncategorized</div>
              )}
              {videoGroups.noComp.map((v) => (
                <button
                  key={v.id}
                  className={`vr-game-card${currentVideo?.id === v.id ? ' active' : ''}`}
                  onClick={() => handleVideoClick(v)}
                >
                  <span className="vr-game-card-name">
                    {v.file_path.replace(/^\d+_/, '')}
                  </span>
                  {v.game_date && (
                    <span className="vr-game-card-date">{formatDate(v.game_date)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ---- Main content area ---- */}
      <div className="vr-main">
        {/* Library toggle (narrow screens) */}
        <div className="vr-topbar">
          <button
            className="btn btn-ghost btn-sm vr-lib-toggle"
            onClick={() => setLibraryOpen((v) => !v)}
            aria-label={libraryOpen ? 'Hide library' : 'Show library'}
          >
            {libraryOpen ? '← Hide Library' : '☰ Games'}
          </button>

          {currentVideo && (
            <button
              className="btn btn-primary btn-sm vr-review-btn"
              onClick={() => enterReviewMode(currentVideo)}
              title="Enter focused Review and Tag mode"
            >
              Review &amp; Tag
            </button>
          )}
        </div>

        {/* Game info bar */}
        {currentVideo && gameName && (
          <div className="game-info-bar">
            <div className="game-info-left">
              <span className="game-info-name">{gameName}</span>
              <div className="game-info-meta">
                {currentVideo.game_date && (
                  <span className="game-info-piece">{formatDate(currentVideo.game_date)}</span>
                )}
                {currentVideo.competition_name && (
                  <span className="badge">{currentVideo.competition_name}</span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setHighlightsOpen(true)}
                title="Export tagged clips as one highlight reel"
              >
                Highlights
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setGameInfoOpen(true)}
              >
                Edit Info
              </button>
            </div>
          </div>
        )}

        {/* No game selected placeholder */}
        {!currentVideo && (
          <div className="vr-no-game">
            <div className="vr-no-game-icon">▶</div>
            <p className="vr-no-game-text">Select a game from the library to start reviewing</p>
          </div>
        )}

        {/* Video player + film controls */}
        {currentVideo && (
          <div className="vr-player-wrap">
            <VideoPlayer
              playerRef={playerRef}
              onReady={handlePlayerReady}
            />
            <FilmControls
              videoId={currentVideo.id}
              player={playerRef.current}
              events={currentVideoEvents}
              visible={!!currentVideo}
            />
          </div>
        )}

        {/* Bottom panel: tag events + players + events list */}
        {currentVideo && (
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
                    title={idx < TAG_KEYS.length ? `Press ${TAG_KEYS[idx]}` : undefined}
                  >
                    <span className="event-tag-name">{et.name}</span>
                    {idx < TAG_KEYS.length && (
                      <span className="event-tag-shortcut">{TAG_KEYS[idx]}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Player selection */}
            <div className="vr-section">
              <h2 className="vr-section-title">Players <span className="vr-optional">(optional)</span></h2>
              {selectedPlayerIds.size > 0 && (
                <div className="vr-sticky-note" role="status">
                  <span>
                    Attaching to every tag:{' '}
                    <strong>
                      {players.filter((p) => selectedPlayerIds.has(p.id)).map(playerLabel).join(', ')}
                    </strong>
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelectedPlayerIds(new Set())}>
                    Clear
                  </button>
                </div>
              )}
              <div className="player-chip-grid">
                {players.map((p) => (
                  <button
                    key={p.id}
                    className={`player-chip${selectedPlayerIds.has(p.id) ? ' selected' : ''}`}
                    onClick={() => togglePlayerSelect(p.id)}
                  >
                    {playerLabel(p)}
                  </button>
                ))}
              </div>
            </div>

            {/* Tagged events */}
            <div className="vr-section">
              <h2 className="vr-section-title">
                Tagged Events
                {currentVideoEvents.length > 0 && (
                  <span className="vr-count">{currentVideoEvents.length}</span>
                )}
              </h2>
              {currentVideoEvents.length === 0 ? (
                <div className="empty-msg">No events tagged yet — tag one above</div>
              ) : (
                <div className="events-list">
                  {currentVideoEvents.map((ev) => (
                    <div key={ev.id} className="event-item">
                      <button
                        className="event-seek-btn"
                        onClick={() => seekToEvent(ev.timestamp)}
                        aria-label={`Play ${ev.event_type_name} at ${formatTime(ev.timestamp)}`}
                      >
                        <span className="event-ts">{formatTime(ev.timestamp)}</span>
                        <span className="event-type-label">{ev.event_type_name}</span>
                        <span className="event-players-label">
                          {ev.players.map(playerLabel).join(', ')}
                        </span>
                      </button>
                      <button
                        className="btn btn-secondary btn-sm event-edit-btn"
                        onClick={() => openEventEdit(ev)}
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
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
      {currentVideo && (
        <HighlightsModal
          open={highlightsOpen}
          videoId={currentVideo.id}
          events={currentVideoEvents}
          eventTypes={eventTypes}
          onClose={() => setHighlightsOpen(false)}
        />
      )}
      <EventEditModal
        open={editEventOpen}
        event={editingEvent}
        events={currentVideoEvents}
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
