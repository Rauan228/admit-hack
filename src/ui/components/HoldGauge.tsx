// Индикатор удержания жеста «обе руки вверх» (событие gesture_hold): человек стоит в 2–3 м от экрана,
// поэтому крупно и поверх всего — видно, что жест принят и сколько осталось держать. progress 0 — скрыт.

import { Icon } from './Icon';
import './HoldGauge.css';

export function HoldGauge({ progress, title, hint }: { progress: number; title: string; hint?: string }) {
  if (progress <= 0) return null;
  return (
    <div className="hold" role="status" aria-live="polite">
      <div className="hold__card">
        <span className="hold__icon">
          <Icon name="arms" size={44} />
        </span>
        <b className="hold__title">{title}</b>
        {hint && <span className="hold__hint">{hint}</span>}
        <div className="hold__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.min(1, progress)})` }} />
        </div>
      </div>
    </div>
  );
}
