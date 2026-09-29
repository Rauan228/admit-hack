import { DwellButton } from './dwell';
import { Icon } from './Icon';
import { MuteToggle } from './MuteToggle';
import './TopBar.css';

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 64 64" width="34" height="34" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill="var(--primary)" />
        <circle cx="32" cy="15" r="6" fill="var(--on-primary)" />
        <path
          d="M32 23v17M32 40l-10 13M32 40l10 13M17 29l15 4 15-4"
          stroke="var(--on-primary)"
          strokeWidth="5.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      FORMA
    </span>
  );
}

export function TopBar({ mock, onHome }: { mock: boolean; onHome?: () => void }) {
  return (
    <header className="topbar">
      <div className="row">
        <Logo />
        {mock && (
          <span className="badge badge--primary topbar__demo">
            Демо<span className="hide-sm"> без камеры</span>
          </span>
        )}
      </div>
      <div className="row">
        {onHome && (
          <DwellButton size="sm" variant="ghost" onSelect={onHome} ariaLabel="В меню">
            <Icon name="home" size={24} />
            <span className="hide-sm">Меню</span>
          </DwellButton>
        )}
        <MuteToggle />
      </div>
    </header>
  );
}
