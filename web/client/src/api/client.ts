import type {
  Player,
  EventType,
  Competition,
  TeamRecord,
  Video,
  GameEvent,
  PlayerEvent,
  ThumbnailStatus,
  EventContext,
  ZoneRule,
  ExportStatus,
  Team,
  ShotDetails,
  Shot,
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

export const getPlayers = (teamId: number | null): Promise<Player[]> =>
  fetch(teamId !== null ? `/api/players?teamId=${teamId}` : '/api/players').then((r) => json<Player[]>(r));

export interface PlayerFields {
  name: string;
  number: number | null;
  position: string | null;
  team_id?: number | null;
}

export const addPlayer = (fields: PlayerFields): Promise<Player> =>
  fetch('/api/players', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
  }).then((r) => json<Player>(r));

export const updatePlayer = (id: number, fields: PlayerFields): Promise<Player> =>
  fetch(`/api/players/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
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
// Teams
// ---------------------------------------------------------------------------

export const getTeams = (): Promise<TeamRecord[]> =>
  fetch('/api/teams').then((r) => json<TeamRecord[]>(r));

export const addTeam = (name: string): Promise<TeamRecord> =>
  fetch('/api/teams', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  }).then((r) => json<TeamRecord>(r));

export const renameTeam = (id: number, name: string): Promise<TeamRecord> =>
  fetch(`/api/teams/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  }).then((r) => json<TeamRecord>(r));

export const deleteTeam = (id: number): Promise<{ id: number; changes: number }> =>
  fetch(`/api/teams/${id}`, { method: 'DELETE' }).then((r) => json(r));

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

export const getVideos = (teamId?: number | null): Promise<Video[]> =>
  fetch(teamId != null ? `/api/videos?teamId=${teamId}` : '/api/videos').then((r) => json<Video[]>(r));

export const getThumbnails = (videoId: number): Promise<ThumbnailStatus> =>
  fetch(`/api/videos/${videoId}/thumbnails`).then((r) => json(r));

export const updateVideoMeta = (
  id: number,
  game_date: string | null,
  competition_id: number | null,
  team_id: number | null
): Promise<Video> =>
  fetch(`/api/videos/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ game_date, competition_id, team_id }),
  }).then((r) => json<Video>(r));

export const uploadVideo = (
  file: File,
  game_date: string | null,
  competition_id: number | null,
  team_id: number | null,
  onProgress: (pct: number, label: string) => void
): Promise<Video> => {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('video', file);
    if (game_date) formData.append('game_date', game_date);
    if (competition_id != null)
      formData.append('competition_id', String(competition_id));
    if (team_id != null) formData.append('team_id', String(team_id));

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
  timestamp: number,
  context: Partial<EventContext> & Partial<ShotDetails> = {}
): Promise<{ id: number } & Partial<ShotDetails>> =>
  fetch('/api/events', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ videoId, eventTypeId, timestamp, ...context }),
  }).then((r) => json(r));

export type EventPatch = Partial<EventContext> & Partial<ShotDetails> & {
  timestamp?: number;
  event_type_id?: number;
  // Also move the later tags still in this tag's old period (see server.js).
  cascade_period?: boolean;
};

export const updateEvent = (eventId: number, patch: EventPatch): Promise<{ id: number; cascaded: number[] }> =>
  fetch(`/api/events/${eventId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  }).then((r) => json(r));

export const updateEventType = (
  id: number,
  patch: { name?: string; zone_rule?: ZoneRule }
): Promise<EventType> =>
  fetch(`/api/event-types/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
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

// ---------------------------------------------------------------------------
// Highlight reels
// ---------------------------------------------------------------------------

export interface ExportRequest {
  videoId: number;
  typeIds: number[];
  team: Team | null;
  pre: number;
  post: number;
  captions: boolean;
}

export const startExport = (req: ExportRequest): Promise<ExportStatus> =>
  fetch('/api/exports', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(req),
  }).then((r) => json<ExportStatus>(r));

export const getExport = (id: string): Promise<ExportStatus> =>
  fetch(`/api/exports/${id}`).then((r) => json<ExportStatus>(r));

export const exportDownloadUrl = (id: string): string => `/exports/${id}`;

// ---------------------------------------------------------------------------
// Shot map
// ---------------------------------------------------------------------------

export const getShots = (videoId?: number, teamId?: number | null): Promise<Shot[]> => {
  const q = new URLSearchParams();
  if (videoId !== undefined) q.set('videoId', String(videoId));
  if (teamId != null) q.set('teamId', String(teamId));
  const qs = q.toString();
  return fetch(qs ? `/api/shots?${qs}` : '/api/shots').then((r) => json<Shot[]>(r));
};
