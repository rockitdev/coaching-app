import { useState, useCallback } from 'react';
import { useApp } from '../App';
import * as api from '../api/client';
import type { PlayerEvent } from '../types';
import GenericModal from './GenericModal';
import './PlayerManagement.css';

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Props {
  isActive: boolean;
  onSwitchToVideo: () => void;
}

export default function PlayerManagement({ isActive, onSwitchToVideo }: Props) {
  const { players, refreshPlayers, openVideo } = useApp();
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [playerEvents, setPlayerEvents] = useState<PlayerEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Add/edit modals
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editPlayer, setEditPlayer] = useState<{ id: number; name: string } | null>(null);

  const selectPlayer = useCallback(async (playerId: number) => {
    setSelectedPlayerId(playerId);
    setLoadingEvents(true);
    try {
      const events = await api.getPlayerEvents(playerId);
      setPlayerEvents(events);
    } catch (e) {
      console.error('Failed to load player events', e);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete ${name}? This also removes their event associations.`)) return;
    await api.deletePlayer(id);
    if (selectedPlayerId === id) {
      setSelectedPlayerId(null);
      setPlayerEvents([]);
    }
    await refreshPlayers();
  }

  function handleEventClick(ev: PlayerEvent) {
    const video = {
      id: ev.video_id,
      file_path: ev.file_path,
      game_date: ev.game_date,
      competition_id: ev.competition_id,
      competition_name: ev.competition_name,
    };
    openVideo(video);
    onSwitchToVideo();
    // Seek after switching tab: video player loads after openVideo sets src
    setTimeout(() => {
      // The VideoReview component will pick up currentVideo and load events;
      // seeking happens via loadedmetadata in VideoPlayer component
      // We store the target timestamp in a data attribute workaround via custom event
      const event = new CustomEvent('hc-seek-to', { detail: { timestamp: ev.timestamp, videoId: ev.video_id } });
      window.dispatchEvent(event);
    }, 100);
  }

  // Group player events by video
  const eventGroups: { videoLabel: string; events: PlayerEvent[] }[] = [];
  let lastVideoId: number | null = null;
  for (const ev of playerEvents) {
    const label =
      ev.file_path.replace(/^\d+_/, '') +
      (ev.game_date ? ` (${ev.game_date})` : '') +
      (ev.competition_name ? ` -- ${ev.competition_name}` : '');
    if (ev.video_id !== lastVideoId) {
      lastVideoId = ev.video_id;
      eventGroups.push({ videoLabel: label, events: [] });
    }
    eventGroups[eventGroups.length - 1].events.push(ev);
  }

  const selectedPlayer = players.find((p) => p.id === selectedPlayerId);

  return (
    <div className="player-mgmt">
      <div className="player-mgmt-left">
        <div className="player-mgmt-header">
          <h2 className="vr-section-title" style={{ margin: 0 }}>Players</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
            + Add Player
          </button>
        </div>
        <ul className="player-list">
          {players.map((p) => (
            <li
              key={p.id}
              className={`player-item${selectedPlayerId === p.id ? ' selected' : ''}`}
              onClick={() => selectPlayer(p.id)}
            >
              <span className="player-name">{p.name}</span>
              <div className="player-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditPlayer(p);
                    setEditOpen(true);
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p.id, p.name);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          {players.length === 0 && <li className="empty-msg">No players yet</li>}
        </ul>
      </div>

      <div className="player-mgmt-right">
        <h2 className="vr-section-title" style={{ margin: '0 0 12px' }}>
          {selectedPlayer ? `${selectedPlayer.name}'s Events` : 'Select a Player'}
        </h2>

        {loadingEvents && <div className="empty-msg">Loading...</div>}

        {!loadingEvents && selectedPlayer && eventGroups.length === 0 && (
          <div className="empty-msg">No events found for {selectedPlayer.name}</div>
        )}

        {!loadingEvents && eventGroups.map((group, gi) => (
          <div key={gi} className="pe-game-group">
            <h3 className="pe-game-title">{group.videoLabel}</h3>
            {group.events.map((ev) => (
              <div
                key={ev.id}
                className="player-event-item"
                onClick={() => handleEventClick(ev)}
              >
                <span className="event-ts">{formatTime(ev.timestamp)}</span>
                <span className="event-type-label">{ev.event_type_name}</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#546e7a' }}>
                  ▶ View
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <GenericModal
        title="Add Player"
        placeholder="Player name"
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={async (name) => {
          await api.addPlayer(name);
          await refreshPlayers();
        }}
      />

      {editPlayer && (
        <GenericModal
          title="Edit Player"
          placeholder="Player name"
          initialValue={editPlayer.name}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSave={async (name) => {
            await api.updatePlayer(editPlayer.id, name);
            await refreshPlayers();
          }}
        />
      )}
    </div>
  );
}
