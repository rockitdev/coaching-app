import { useId, type ReactNode, type PointerEvent } from 'react';
import './Rink.css';

// Half-rink diagram, attacked net at the top, in feet (NHL dimensions):
// x 0-85 across from the left boards, y 0-100 down from the end boards.
// Matches events.loc_x / loc_y, so children can draw marks in feet directly.
export const RINK_W = 85;
export const RINK_H = 100;
const GOAL_LINE = 11;
const BLUE_LINE = 75;
const CORNER = 28;
const NET_X = RINK_W / 2;
const DOT_Y = GOAL_LINE + 20;
const DOT_XS = [NET_X - 22, NET_X + 22];

// "Home plate": goal posts -> faceoff dots -> tops of the circles. Shots from
// in here score far more often than shots from outside it.
export const HOME_PLATE: [number, number][] = [
  [NET_X - 3, GOAL_LINE], [DOT_XS[0], DOT_Y], [DOT_XS[0], DOT_Y + 15],
  [DOT_XS[1], DOT_Y + 15], [DOT_XS[1], DOT_Y], [NET_X + 3, GOAL_LINE],
];

export function inHomePlate(x: number, y: number): boolean {
  // Ray-casting point-in-polygon.
  let inside = false;
  for (let i = 0, j = HOME_PLATE.length - 1; i < HOME_PLATE.length; j = i++) {
    const [xi, yi] = HOME_PLATE[i];
    const [xj, yj] = HOME_PLATE[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface Props {
  // Called with a location in feet when the rink is tapped.
  onPick?: (x: number, y: number) => void;
  showHomePlate?: boolean;
  label?: string;
  className?: string;
  children?: ReactNode;
}

export default function Rink({ onPick, showHomePlate = false, label = 'Rink', className = '', children }: Props) {
  const clipId = `rink-clip-${useId().replace(/:/g, '')}`;
  function handlePointer(e: PointerEvent<SVGSVGElement>) {
    if (!onPick) return;
    const pt = e.currentTarget.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = e.currentTarget.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    const round = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)) * 10) / 10;
    onPick(round(p.x, RINK_W), round(p.y, RINK_H));
  }

  const boards =
    `M0,${RINK_H} V${CORNER} A${CORNER},${CORNER} 0 0 1 ${CORNER},0 ` +
    `H${RINK_W - CORNER} A${CORNER},${CORNER} 0 0 1 ${RINK_W},${CORNER} V${RINK_H} Z`;

  return (
    <svg
      className={`rink${onPick ? ' rink-pickable' : ''} ${className}`}
      viewBox={`-1 -1 ${RINK_W + 2} ${RINK_H + 2}`}
      role={onPick ? 'button' : 'img'}
      aria-label={label}
      onPointerDown={handlePointer}
    >
      <path className="rink-ice" d={boards} />
      <clipPath id={clipId}><path d={boards} /></clipPath>
      <g clipPath={`url(#${clipId})`}>
        {showHomePlate && (
          <polygon className="rink-home-plate" points={HOME_PLATE.map((p) => p.join(',')).join(' ')} />
        )}
        <line className="rink-goal-line" x1={0} x2={RINK_W} y1={GOAL_LINE} y2={GOAL_LINE} />
        <rect className="rink-blue-line" x={0} y={BLUE_LINE - 0.5} width={RINK_W} height={1} />
        <rect className="rink-red-line" x={0} y={RINK_H - 0.5} width={RINK_W} height={1} />
        {DOT_XS.map((x) => (
          <g key={x}>
            <circle className="rink-circle" cx={x} cy={DOT_Y} r={15} />
            <circle className="rink-dot" cx={x} cy={DOT_Y} r={1} />
            <circle className="rink-dot" cx={x} cy={BLUE_LINE + 5} r={1} />
          </g>
        ))}
        <path className="rink-crease" d={`M${NET_X - 4},${GOAL_LINE} A6,6 0 0 0 ${NET_X + 4},${GOAL_LINE} Z`} />
        <rect className="rink-net" x={NET_X - 3} y={GOAL_LINE - 3.5} width={6} height={3.5} rx={1} />
      </g>
      <path className="rink-boards" d={boards} />
      {children}
    </svg>
  );
}
