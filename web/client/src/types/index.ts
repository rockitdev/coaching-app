export interface Player {
  id: number;
  name: string;
}

export interface EventType {
  id: number;
  name: string;
  is_custom: number;
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
}

export interface EventPlayer {
  id: number;
  name: string;
}

export interface GameEvent {
  id: number;
  video_id: number;
  event_type_id: number;
  event_type_name: string;
  timestamp: number;
  players: EventPlayer[];
}

export interface PlayerEvent {
  id: number;
  video_id: number;
  file_path: string;
  game_date: string | null;
  competition_id: number | null;
  competition_name: string | null;
  event_type_id: number;
  event_type_name: string;
  timestamp: number;
}
