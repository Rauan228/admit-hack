// Верхняя панель платформы: логотип; справа — демо, «Жесты» (камера и управление рукой), аккаунт, меню, звук.

import { DwellButton } from './dwell';
import { Icon } from './Icon';
import { MuteToggle } from './MuteToggle';
import './TopBar.css';

export function Logo() {
  return <span className="logo">FORMA</span>;
}

export function TopBar({
  mock,
  onHome,
  account,
  onExitDemo,
  gestures,
}: {
  mock: boolean;
  onHome?: () => void;
  /** Кнопка аккаунта: ник (→ прогресс) или «Войти». */
  account?: { label: string; signedIn: boolean; onSelect: () => void };
  onExitDemo?: () => void;
  /** «Жесты»: включить камеру и управлять платформой рукой. */
  gestures?: { on: boolean; onToggle: () => void };
}) {
  return (
    <header className="topbar">
      <div className="topbar__side">
        {onHome ? (
          <button type="button" className="topbar__logo" onClick={onHome} aria-label="FORMA — в меню">
            <Logo />
          </button>
        ) : (
          <Logo />
        )}
        {mock && (
          <span className="topbar__demo">
            демо<span className="hide-sm"> · без камеры</span>
          </span>
        )}
      </div>
      <div className="topbar__side">
        {onExitDemo && (
          <DwellButton size="sm" variant="ghost" onSelect={onExitDemo}>
            <Icon name="close" size={16} /> <span className="hide-sm">Выйти из демо</span>
          </DwellButton>
        )}
        {gestures && (
          <DwellButton
            size="sm"
            variant="ghost"
            className={gestures.on ? 'topbar__gestures is-on' : 'topbar__gestures'}
            onSelect={gestures.onToggle}
            ariaLabel={gestures.on ? 'Выключить жесты и камеру' : 'Управлять жестами (включит камеру)'}
          >
            <Icon name="hand" size={18} />
            <span className="hide-sm">{gestures.on ? 'Жесты вкл' : 'Жесты'}</span>
          </DwellButton>
        )}
        {onHome && (
          <DwellButton size="sm" variant="ghost" onSelect={onHome} ariaLabel="В меню">
            <Icon name="home" size={18} />
            <span className="hide-sm">Меню</span>
          </DwellButton>
        )}
        {account && (
          <DwellButton
            size="sm"
            variant="ghost"
            className="topbar__account"
            onSelect={account.onSelect}
            ariaLabel={account.signedIn ? `Профиль: ${account.label}` : 'Войти'}
          >
            <span className="topbar__avatar" aria-hidden="true">
              {account.signedIn ? account.label.slice(0, 1).toUpperCase() : <Icon name="user" size={16} />}
            </span>
            <span className={account.signedIn ? 'topbar__nick' : 'hide-sm'}>{account.label}</span>
          </DwellButton>
        )}
        <MuteToggle />
      </div>
    </header>
  );
}
