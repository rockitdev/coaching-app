// Hockey-specific helpers shared across views: labels, and the zone ribbon
// derived from tagged events.
import type { EventType, GameEvent, ShotResult, ShotSituation, ShotType, Team } from './types';

export const PERIODS = [1, 2, 3, 4];

export function periodLabel(p: number | null): string {
  if (p === null) return '';
  return p === 4 ? 'OT' : `P${p}`;
}

export function playerLabel(p: { name: string; number: number | null }): string {
  return p.number !== null ? `#${p.number} ${p.name}` : p.name;
}

// Shot vocabulary, in the order the buttons appear.
export const SHOT_RESULTS: [ShotResult, string][] = [
  ['goal', 'Goal'], ['saved', 'Saved'], ['missed', 'Missed'], ['blocked', 'Blocked'],
];
export const SHOT_TYPES: [ShotType, string][] = [
  ['wrist', 'Wrist'], ['snap', 'Snap'], ['slap', 'Slap'], ['backhand', 'Backhand'], ['tip', 'Tip'], ['wrap', 'Wrap'],
];
export const SHOT_SITUATIONS: [ShotSituation, string][] = [
  ['rush', 'Rush'], ['cycle', 'Cycle'], ['rebound', 'Rebound'], ['faceoff', 'Off faceoff'], ['point', 'Point shot'],
];

// A shot within this many seconds of the same team's previous shot is a rebound.
export const REBOUND_SEC = 3;

export function isShot(eventTypes: EventType[], typeId: number): boolean {
  return eventTypes.some((t) => t.id === typeId && t.shot_kind !== null);
}

// The tags a period change on `eventId` cascades to: the unbroken run of later
// tags (time order) still in its old period. Mirrors PATCH cascade_period.
export function periodCascade(events: GameEvent[], eventId: number): GameEvent[] {
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
  const i = ordered.findIndex((e) => e.id === eventId);
  if (i === -1) return [];
  const old = ordered[i].period;
  const run: GameEvent[] = [];
  for (const e of ordered.slice(i + 1)) {
    if (e.period !== old) break;
    run.push(e);
  }
  return run;
}

// ---------------------------------------------------------------------------
// Zone ribbon
//
// Zones are from our point of view: 'oz' = we're in our offensive zone,
// 'dz' = our defensive zone, 'nz' = neutral. Each tag whose type has a zone
// rule (and a team) says where play is at that moment:
//   entry / attack by us   -> oz      entry / attack by them -> dz
//   defend by us           -> dz      defend by them         -> oz
//   exit by either team    -> nz
// The zone holds until the next zone tag or HOLD_SEC of no supporting tags
// (which also covers intermissions) -- an untagged stretch shows as unknown
// rather than guessing. Point evidence (a shot) with no tagged entry is backfilled a few
// seconds, since play must already have been in the zone.
// ---------------------------------------------------------------------------
export type Zone = 'oz' | 'dz' | 'nz';

export interface ZoneSegment {
  start: number;
  end: number;
  zone: Zone;
}

const HOLD_SEC = 45;
const BACKFILL_SEC = 5;

function zoneFor(rule: EventType['zone_rule'], team: Team): Zone | null {
  switch (rule) {
    case 'entry':
    case 'attack':
      return team === 'us' ? 'oz' : 'dz';
    case 'defend':
      return team === 'us' ? 'dz' : 'oz';
    case 'exit':
      return 'nz';
    default:
      return null;
  }
}

export function computeZones(events: GameEvent[], eventTypes: EventType[], duration: number): ZoneSegment[] {
  const rules = new Map(eventTypes.map((t) => [t.id, t.zone_rule]));
  const points = events
    .filter((e) => e.team !== null)
    .map((e) => {
      const rule = rules.get(e.event_type_id) ?? 'none';
      return { t: e.timestamp, rule, zone: zoneFor(rule, e.team as Team) };
    })
    .filter((p): p is { t: number; rule: EventType['zone_rule']; zone: Zone } => p.zone !== null)
    .sort((a, b) => a.t - b.t);

  const segments: ZoneSegment[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    const prev = segments[segments.length - 1];
    let end = Math.min(p.t + HOLD_SEC, duration || Infinity);
    if (next) end = Math.min(end, next.t);
    // Shots / saves are evidence the zone started a little earlier.
    let start = p.t;
    const isPointEvidence = p.rule === 'attack' || p.rule === 'defend';
    if (isPointEvidence && !(prev && prev.zone === p.zone && p.t - prev.end < 0.01)) {
      start = Math.max(p.t - BACKFILL_SEC, prev ? prev.end : 0);
    }
    if (prev && prev.zone === p.zone && start - prev.end < 0.01) {
      prev.end = Math.max(prev.end, end);
    } else if (end > start) {
      segments.push({ start, end, zone: p.zone });
    }
  }
  return segments;
}

export function zoneTotals(segments: ZoneSegment[]): Record<Zone, number> {
  const totals: Record<Zone, number> = { oz: 0, dz: 0, nz: 0 };
  for (const s of segments) totals[s.zone] += s.end - s.start;
  return totals;
}
