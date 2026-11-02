import { useApp } from '../App';

interface Props {
  onManage: () => void;
  className?: string;
}

// Segmented control for which team the app is scoped to, plus a "manage" button.
export default function TeamSwitch({ onManage, className = '' }: Props) {
  const { teams, currentTeamId, setCurrentTeamId } = useApp();
  return (
    <div className={`team-switch ${className}`.trim()} role="group" aria-label="Team">
      {teams.map((t) => (
        <button
          key={t.id}
          className={`team-switch-btn${t.id === currentTeamId ? ' active' : ''}`}
          aria-pressed={t.id === currentTeamId}
          onClick={() => setCurrentTeamId(t.id)}
        >
          {t.name}
        </button>
      ))}
      <button
        className="team-switch-btn team-switch-manage"
        onClick={onManage}
        title="Manage teams"
        aria-label="Manage teams"
      >
        ⋯
      </button>
    </div>
  );
}
