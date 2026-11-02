import type { ShotDetails, ShotResult, Team } from '../types';
import { SHOT_RESULTS, SHOT_SITUATIONS, SHOT_TYPES } from '../hockey';
import Rink from './Rink';
import './ShotDetails.css';

// One shot drawn on a Rink, in feet. Shape carries the result so it never
// relies on colour alone: goal = ringed dot, saved = dot, missed = hollow
// ring, blocked = cross, unknown = small dot. Colour is the shooting team.
export function ShotMark({
  x, y, result, team, scale = 1,
}: { x: number; y: number; result: ShotResult | null; team: Team | null; scale?: number }) {
  const cls = `shot-mark team-${team ?? 'none'}`;
  const r = 1.6 * scale;
  switch (result) {
    case 'goal':
      return (
        <g className={cls}>
          <circle cx={x} cy={y} r={r * 1.9} className="shot-mark-ring" />
          <circle cx={x} cy={y} r={r * 1.1} className="shot-mark-fill" />
        </g>
      );
    case 'missed':
      return <circle className={`${cls} shot-mark-hollow`} cx={x} cy={y} r={r} />;
    case 'blocked': {
      const d = r * 0.9;
      return (
        <path
          className={`${cls} shot-mark-cross`}
          d={`M${x - d},${y - d} L${x + d},${y + d} M${x + d},${y - d} L${x - d},${y + d}`}
        />
      );
    }
    case 'saved':
      return <circle className={`${cls} shot-mark-fill`} cx={x} cy={y} r={r} />;
    default:
      return <circle className={`${cls} shot-mark-fill shot-mark-unknown`} cx={x} cy={y} r={r * 0.75} />;
  }
}

function Segment<T extends string>({
  label, options, value, onChange,
}: { label: string; options: [T, string][]; value: T | null; onChange: (v: T | null) => void }) {
  return (
    <div className="shot-seg-row">
      <span className="shot-seg-label">{label}</span>
      <div className="shot-seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            className={`shot-seg-btn${value === v ? ' active' : ''}${v === 'goal' ? ' is-goal' : ''}`}
            aria-pressed={value === v}
            // Clicking the selected option clears it back to unknown.
            onClick={() => onChange(value === v ? null : v)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  value: ShotDetails;
  team: Team | null;
  onChange: (patch: Partial<ShotDetails>) => void;
  compact?: boolean;
}

// Result / type / situation buttons plus a tap-to-place rink, used in the
// Review & Tag last-tag strip and the Edit Event dialog.
export default function ShotDetailsEditor({ value, team, onChange, compact = false }: Props) {
  const located = value.loc_x !== null && value.loc_y !== null;
  return (
    <div className={`shot-details${compact ? ' compact' : ''}`}>
      <div className="shot-details-fields">
        <Segment label="Result" options={SHOT_RESULTS} value={value.shot_result}
          onChange={(v) => onChange({ shot_result: v })} />
        <Segment label="Type" options={SHOT_TYPES} value={value.shot_type}
          onChange={(v) => onChange({ shot_type: v })} />
        <Segment label="Situation" options={SHOT_SITUATIONS} value={value.shot_situation}
          onChange={(v) => onChange({ shot_situation: v })} />
      </div>
      <div className="shot-details-rink">
        <Rink
          label={`Tap where the shot was taken from${located ? ' (location set)' : ''}`}
          onPick={(x, y) => onChange({ loc_x: x, loc_y: y })}
        >
          {located && <ShotMark x={value.loc_x!} y={value.loc_y!} result={value.shot_result} team={team} scale={1.4} />}
        </Rink>
        <div className="shot-details-rink-caption">
          {located ? (
            <button type="button" className="shot-link-btn" onClick={() => onChange({ loc_x: null, loc_y: null })}>
              Clear spot
            </button>
          ) : (
            <span>{team === 'them' ? 'Tap spot · our net' : 'Tap spot · their net'}</span>
          )}
        </div>
      </div>
    </div>
  );
}
