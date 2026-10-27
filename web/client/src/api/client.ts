import type {
  Player,
  EventType,
  Competition,
  Video,
  GameEvent,
  PlayerEvent,
} from '../types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    return res.json().then((e: { error?: string }) => {
      throw new Error(e.error ?? `HTTP ${res.status}`);
    });
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export const getPlayers = (): Promise<Player[]> =>
  fetch('/api/players').then((r) => json<Player[]>(r));

export const addPlayer = (name: string): Promise<Player> =>
  fetch('/api/players', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  }).then((r) => json<Player>(r));

export const updatePlayer = (id: number, name: string): Promise<Player> =>
  fetch(`/api/players/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  }).then((r) => json<Player>(r));

export const deletePlayer = (id: number): Promise<{ id: number; changes: number }> =>
  fetch(`/api/players/${id}`, { method: 'DELETE' }).then((r) =>
    json(r)
  );

export const getPlayerEvents = (playerId: number): Promise<PlayerEvent[]> =>
  fetch(`/api/players/${playerId}/events`).then((r) => json<PlayerEvent[]>(r));

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export const getEventTypes = (): Promise<EventType[]> =>
  fetch('/api/event-types').then((r) => json<EventType[]>(r));

export const addEventType = (name: string, isCustom: boolean): Promise<EventType> =>
  fetch('/api/event-types', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, is_custom: isCustom }),
  }).then((r) => json<EventType>(r));

// ---------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------

export const getCompetitions = (): Promise<Competition[]> =>
  fetch('/api/competitions').then((r) => json<Competition[]>(r));

export const addCompetition = (name: string): Promise<Competition> =>
  fetch('/api/competitions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  }).then((r) => json<Competition>(r));

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export const getVideos = (): Promise<Video[]> =>
  fetch('/api/videos').then((r) => json<Video[]>(r));

export const updateVideoMeta = (
  id: number,
  game_date: string | null,
  competition_id: number | null
): Promise<Video> =>
  fetch(`/api/videos/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ game_date, competition_id }),
  }).then((r) => json<Video>(r));

export const uploadVideo = (
  file: File,
  game_date: string | null,
  competition_id: number | null,
  onProgress: (pct: number, label: string) => void
): Promise<Video> => {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('video', file);
    if (game_date) formData.append('game_date', game_date);
    if (competition_id != null)
      formData.append('competition_id', String(competition_id));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 95);
        const mb = (e.loaded / 1024 / 1024).toFixed(1);
        const total = (e.total / 1024 / 1024).toFixed(1);
        onProgress(pct, `Uploading ${mb} / ${total} MB...`);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Video);
        } catch {
          reject(new Error('Invalid server response'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText) as { error?: string };
          reject(new Error(err.error ?? `Upload failed: HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.send(formData);
  });
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const getVideoEvents = (videoId: number): Promise<GameEvent[]> =>
  fetch(`/api/events?videoId=${videoId}`).then((r) => json<GameEvent[]>(r));

export const getEvent = (eventId: number): Promise<GameEvent & { video_id: number }> =>
  fetch(`/api/events/${eventId}`).then((r) => json(r));

export const addEvent = (
  videoId: number,
  eventTypeId: number,
  timestamp: number
): Promise<{ id: number }> =>
  fetch('/api/events', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ videoId, eventTypeId, timestamp }),
  }).then((r) => json(r));

export const updateEventPlayers = (
  eventId: number,
  playerIds: number[]
): Promise<{ eventId: number; updated: boolean }> =>
  fetch(`/api/events/${eventId}/players`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ playerIds }),
  }).then((r) => json(r));

export const addEventPlayerAssociation = (
  eventId: number,
  playerId: number
): Promise<{ event_id: number; player_id: number }> =>
  fetch(`/api/events/${eventId}/players`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ playerId }),
  }).then((r) => json(r));

export const deleteEvent = (
  eventId: number
): Promise<{ eventId: number; deleted: boolean }> =>
  fetch(`/api/events/${eventId}`, { method: 'DELETE' }).then((r) => json(r));
