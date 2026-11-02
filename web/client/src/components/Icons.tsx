// Inline stroke icons. Unicode glyphs like ▶ and ⏸ render as colour emoji on
// iOS, so transport controls use these instead.

interface IconProps {
  size?: number;
}

function Svg({ size = 20, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function PlayIcon(p: IconProps) {
  return <Svg {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></Svg>;
}

export function PauseIcon(p: IconProps) {
  return <Svg {...p}><path d="M8 5v14M16 5v14" strokeWidth={3} /></Svg>;
}

export function PrevEventIcon(p: IconProps) {
  return <Svg {...p}><path d="M6 5v14M18 6l-8 6 8 6z" fill="currentColor" /></Svg>;
}

export function NextEventIcon(p: IconProps) {
  return <Svg {...p}><path d="M18 5v14M6 6l8 6-8 6z" fill="currentColor" /></Svg>;
}

export function UndoIcon(p: IconProps) {
  return <Svg {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></Svg>;
}

export function CloseIcon(p: IconProps) {
  return <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
}

export function BackIcon(p: IconProps) {
  return <Svg {...p}><path d="M15 18l-6-6 6-6" /></Svg>;
}
