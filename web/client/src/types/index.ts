export interface Player {
  id: number;
  name: string;
  number: number | null;
  position: string | null;
  team_id: number | null;
}

// The team that performed the action; strength is from our point of view.
export type Team = 'us' | 'them';
export type Strength = 'EV' | 'PP' | 'PK';
// How a tag of this type moves the zone ribbon (see server.js).
export type ZoneRule = 'entry' | 'exit' | 'attack' | 'defend' | 'none';
export type ShotResult = 'goal' | 'saved' | 'missed' | 'blocked';
export type ShotType = 'wrist' | 'snap' | 'slap' | 'backhand' | 'tip' | 'wrap';
export type ShotSituation = 'rush' | 'cycle' | 'rebound' | 'faceoff' | 'point';

export interface EventType {
  id: number;
  name: string;
  is_custom: number;
  zone_rule: ZoneRule;
  // Shot and Goal are both shots; a Goal tag is a shot whose result is goal.
  shot_kind: 'shot' | 'goal' | null;
}

export interface TeamRecord {
  id: number;
  name: string;
}

export interface Competition {
  id: number;
  name: string;
  is_custom: number;
}

export interface Video {
  id: number;
  file_path: string;
  game_date: string | null;
  competition_id: number | null;
  competition_name: string | null;
  competition_is_custom?: number;
  team_id: number | null;
  team_name?: string | null;
}

export interface EventPlayer {
  id: number;
  name: string;
  number: number | null;
}

// Optional hockey context on an event; null = not recorded.
export interface EventContext {
  team: Team | null;
  period: number | null;
  strength: Strength | null;
}

// Shot details (only meaningful on Shot / Goal tags). Location is in feet on a
// half rink with the attacked net at the top: loc_x 0-85 across from the left
// boards, loc_y 0-100 down from the end boards (see Rink.tsx).
export interface ShotDetails {
  shot_result: ShotResult | null;
  shot_type: ShotType | null;
  shot_situation: ShotSituation | null;
  loc_x: number | null;
  loc_y: number | null;
}

export interface GameEvent extends EventContext, ShotDetails {
  id: number;
  video_id: number;
  event_type_id: number;
  event_type_name: string;
  timestamp: number;
  players: EventPlayer[];
}

export interface PlayerEvent extends EventContext, ShotDetails {
  id: number;
  video_id: number;
  file_path: string;
  game_date: string | null;
  competition_id: number | null;
  competition_name: string | null;
  team_id: number | null;
  event_type_id: number;
  event_type_name: string;
  timestamp: number;
}

// Timeline thumbnail sprite sheets for a video (GET /api/videos/:id/thumbnails).
// Frame for second t: sheet floor(t / interval / (cols*rows)), cell within it.
export type ThumbnailStatus =
  | ({ status: 'ready' } & ThumbnailMeta)
  | { status: 'queued' | 'running'; progress: number }
  | { status: 'error'; error: string }
  | { status: 'missing' };

export interface ThumbnailMeta {
  interval: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  sheets: number;
  duration: number;
}

export interface ExportStatus {
  id: string;
  state: 'queued' | 'running' | 'ready' | 'error';
  progress: number;
  error?: string;
  clips: number;
  duration: number;
}

// GET /api/shots -- a Shot / Goal tag with the game it came from.
export interface Shot extends GameEvent {
  file_path: string;
  game_date: string | null;
}
