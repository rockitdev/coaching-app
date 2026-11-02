import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import type { Player, EventType, Competition, TeamRecord, Video, GameEvent } from './types';
import type VideoPlayer from 'video.js/dist/types/player';
import * as api from './api/client';
import VideoReview from './components/VideoReview';
import ShotMap from './components/ShotMap';
import PlayerManagement from './components/PlayerManagement';
import ReviewAndTagMode from './components/ReviewAndTagMode';
import TeamsModal from './components/TeamsModal';
import TeamSwitch from './components/TeamSwitch';
import { loadSession, saveSession } from './session';
import './App.css';

// ---------------------------------------------------------------------------
// App context -- shared state across all components
// ---------------------------------------------------------------------------

interface AppCtx {
  // The team being worked on. Games, roster and shots are all scoped to it.
  teams: TeamRecord[];
  currentTeamId: number | null;
  currentTeam: TeamRecord | null;
  setCurrentTeamId: (id: number) => void;
  refreshTeams: () => Promise<void>;
  openTeamsModal: () => void;
  players: Player[];
  eventTypes: EventType[];
  competitions: Competition[];
  currentVideo: Video | null;
  currentVideoEvents: GameEvent[];
  playerRef: React.MutableRefObject<VideoPlayer | null>;
  refreshPlayers: () => Promise<void>;
  refreshEventTypes: () => Promise<void>;
  refreshCompetitions: () => Promise<void>;
  openVideo: (video: Video) => void;
  setCurrentVideoEvents: React.Dispatch<React.SetStateAction<GameEvent[]>>;
  // Review & Tag mode
  reviewVideo: Video | null;
  enterReviewMode: (video: Video) => void;
  exitReviewMode: () => void;
}

const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

type Tab = 'video-review' | 'shot-map' | 'player-profiles';

export default function App() {
  const [tab, setTab] = useState<Tab>('video-review');
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  // Start from the saved team so the first fetches are already scoped.
  const [currentTeamId, setCurrentTeamIdState] = useState<number | null>(() => loadSession()?.teamId ?? null);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);
  const [currentVideoEvents, setCurrentVideoEvents] = useState<GameEvent[]>([]);
  const [reviewVideo, setReviewVideo] = useState<Video | null>(null);

  // Ref to the video.js player instance, shared via context
  const playerRef = useRef<VideoPlayer | null>(null);

  const refreshTeams = useCallback(async () => {
    const data = await api.getTeams();
    setTeams(data);
    // Fall back to the first team if none is chosen or the chosen one is gone.
    setCurrentTeamIdState((cur) => (cur !== null && data.some((t) => t.id === cur) ? cur : data[0]?.id ?? null));
  }, []);

  const refreshPlayers = useCallback(async () => {
    const data = await api.getPlayers(currentTeamId);
    setPlayers(data);
  }, [currentTeamId]);

  const refreshEventTypes = useCallback(async () => {
    const data = await api.getEventTypes();
    setEventTypes(data);
  }, []);

  const refreshCompetitions = useCallback(async () => {
    const data = await api.getCompetitions();
    setCompetitions(data);
  }, []);

  const openVideo = useCallback((video: Video) => {
    setCurrentVideo(video);
    setCurrentVideoEvents([]);
    // Opening a game from another team (e.g. a player's history) follows it.
    if (video.team_id !== null && video.team_id !== undefined) setCurrentTeamIdState(video.team_id);
  }, []);

  // Switching teams closes the open game: it belongs to the other roster.
  const setCurrentTeamId = useCallback((id: number) => {
    setCurrentTeamIdState((cur) => {
      if (cur !== id) {
        setCurrentVideo(null);
        setCurrentVideoEvents([]);
        setReviewVideo(null);
      }
      return id;
    });
  }, []);

  const enterReviewMode = useCallback((video: Video) => {
    setReviewVideo(video);
  }, []);

  const exitReviewMode = useCallback(() => {
    setReviewVideo(null);
  }, []);

  useEffect(() => {
    refreshTeams();
    refreshEventTypes();
    refreshCompetitions();
  }, [refreshTeams, refreshEventTypes, refreshCompetitions]);

  // The roster follows the current team.
  useEffect(() => {
    if (currentTeamId === null) return;
    refreshPlayers();
  }, [currentTeamId, refreshPlayers]);

  // Reopen the game, view and tab from before a reload. The playhead itself is
  // restored by each player (see session.ts bindResume).
  const sessionRestored = useRef(false);
  useEffect(() => {
    const saved = loadSession();
    if (!saved) {
      sessionRestored.current = true;
      return;
    }
    if (['video-review', 'shot-map', 'player-profiles'].includes(saved.tab)) setTab(saved.tab);
    api.getVideos()
      .then((videos) => {
        const video = videos.find((v) => v.id === saved.videoId);
        if (!video) return;
        setCurrentVideo(video);
        if (video.team_id !== null) setCurrentTeamIdState(video.team_id);
        if (saved.mode === 'review') setReviewVideo(video);
      })
      .catch(() => {})
      .finally(() => {
        sessionRestored.current = true;
      });
  }, []);

  useEffect(() => {
    // Don't overwrite the saved session with the empty startup state.
    if (!sessionRestored.current) return;
    saveSession({
      teamId: currentTeamId,
      videoId: reviewVideo?.id ?? currentVideo?.id ?? null,
      mode: reviewVideo ? 'review' : 'library',
      tab,
    });
  }, [currentVideo, reviewVideo, tab, currentTeamId]);

  const currentTeam = teams.find((t) => t.id === currentTeamId) ?? null;

  const ctx: AppCtx = {
    teams,
    currentTeamId,
    currentTeam,
    setCurrentTeamId,
    refreshTeams,
    openTeamsModal: () => setTeamsOpen(true),
    players,
    eventTypes,
    competitions,
    currentVideo,
    currentVideoEvents,
    playerRef,
    refreshPlayers,
    refreshEventTypes,
    refreshCompetitions,
    openVideo,
    setCurrentVideoEvents,
    reviewVideo,
    enterReviewMode,
    exitReviewMode,
  };

  // When in Review & Tag mode, render the full-screen overlay.
  // The normal tab layout is NOT rendered, which disposes the VideoReview
  // player — ReviewAndTagMode creates its own independent player instance.
  return (
    <AppContext.Provider value={ctx}>
      {reviewVideo !== null ? (
        <ReviewAndTagMode />
      ) : (
        <div className="app-root">
          <header className="app-header">
            <h1 className="app-title">
              <span className="app-title-accent">HC</span>
              <span>Coach</span>
            </h1>
            <TeamSwitch className="team-switch-header" onManage={() => setTeamsOpen(true)} />
            <nav className="tab-nav">
              <button
                className={`tab-btn${tab === 'video-review' ? ' active' : ''}`}
                onClick={() => setTab('video-review')}
              >
                Video Review
              </button>
              <button
                className={`tab-btn${tab === 'shot-map' ? ' active' : ''}`}
                onClick={() => setTab('shot-map')}
              >
                Shot Map
              </button>
              <button
                className={`tab-btn${tab === 'player-profiles' ? ' active' : ''}`}
                onClick={() => setTab('player-profiles')}
              >
                Players
              </button>
            </nav>
          </header>

          <main className="app-main">
            <div style={{ display: tab === 'video-review' ? 'contents' : 'none' }}>
              <VideoReview isActive={tab === 'video-review'} />
            </div>
            <div style={{ display: tab === 'shot-map' ? 'contents' : 'none' }}>
              <ShotMap isActive={tab === 'shot-map'} onSwitchToVideo={() => setTab('video-review')} />
            </div>
            <div style={{ display: tab === 'player-profiles' ? 'contents' : 'none' }}>
              <PlayerManagement
                isActive={tab === 'player-profiles'}
                onSwitchToVideo={() => setTab('video-review')}
              />
            </div>
          </main>
          <TeamsModal open={teamsOpen} onClose={() => setTeamsOpen(false)} />
        </div>
      )}
    </AppContext.Provider>
  );
}
