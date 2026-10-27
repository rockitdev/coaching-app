import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import type { Player, EventType, Competition, Video, GameEvent } from './types';
import type VideoPlayer from 'video.js/dist/types/player';
import * as api from './api/client';
import VideoReview from './components/VideoReview';
import PlayerManagement from './components/PlayerManagement';
import './App.css';

// ---------------------------------------------------------------------------
// App context -- shared state across all components
// ---------------------------------------------------------------------------

interface AppCtx {
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

type Tab = 'video-review' | 'player-profiles';

export default function App() {
  const [tab, setTab] = useState<Tab>('video-review');
  const [players, setPlayers] = useState<Player[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);
  const [currentVideoEvents, setCurrentVideoEvents] = useState<GameEvent[]>([]);

  // Ref to the video.js player instance, shared via context
  const playerRef = useRef<VideoPlayer | null>(null);

  const refreshPlayers = useCallback(async () => {
    const data = await api.getPlayers();
    setPlayers(data);
  }, []);

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
  }, []);

  useEffect(() => {
    refreshPlayers();
    refreshEventTypes();
    refreshCompetitions();
  }, [refreshPlayers, refreshEventTypes, refreshCompetitions]);

  const ctx: AppCtx = {
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
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="app-root">
        <header className="app-header">
          <h1 className="app-title">Hockey Coach</h1>
          <nav className="tab-nav">
            <button
              className={`tab-btn${tab === 'video-review' ? ' active' : ''}`}
              onClick={() => setTab('video-review')}
            >
              Video Review
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
          <div style={{ display: tab === 'player-profiles' ? 'contents' : 'none' }}>
            <PlayerManagement
              isActive={tab === 'player-profiles'}
              onSwitchToVideo={() => setTab('video-review')}
            />
          </div>
        </main>
      </div>
    </AppContext.Provider>
  );
}
