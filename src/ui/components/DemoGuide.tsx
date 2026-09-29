// Подсказка поверх демо-тура: какой шаг идёт и что сейчас видно на экране; выход из демо — всегда под рукой.

import { useState } from 'react';
import { useEngineEvents } from '../engine/bus';
import { DEMO_STEPS, type DemoStepId } from '../screens/demoSteps';
import { Icon } from './Icon';
import './DemoGuide.css';

/** Шаг по текущему экрану; внутри подхода — «счёт», пока не пришла первая ошибка. */
function stepFor(screen: string, sawError: boolean): DemoStepId | null {
  if (screen === 'calibration' || screen === 'loading') return 'calibration';
  if (screen === 'intro') return 'intro';
  if (screen === 'workout') return sawError ? 'error' : 'count';
  if (screen === 'summary') return 'summary';
  return null;
}

export function DemoGuide({
  screen,
  onExit,
  onCamera,
}: {
  screen: string;
  onExit: () => void;
  onCamera: () => void;
}) {
  const [errorAt, setErrorAt] = useState<string | null>(null);
  useEngineEvents((e) => {
    if (e.type === 'form_error') setErrorAt(screen);
  });
  // Ошибка «живёт» только в подходе, где она случилась.
  const step = stepFor(screen, errorAt === screen && screen === 'workout');
  const i = DEMO_STEPS.findIndex((s) => s.id === step);
  const cur = DEMO_STEPS[i];

  return (
    <aside className="demo-guide" aria-live="polite">
      <div className="demo-guide__card">
        {cur ? (
          <>
            <div className="demo-guide__steps" aria-hidden="true">
              {DEMO_STEPS.map((s, k) => (
                <span key={s.id} className={k < i ? 'is-done' : k === i ? 'is-on' : ''} />
              ))}
            </div>
            <p className="demo-guide__text" key={cur.id}>
              <b>
                Шаг {i + 1} из {DEMO_STEPS.length} · {cur.title}.
              </b>{' '}
              {cur.caption}
            </p>
          </>
        ) : (
          <p className="demo-guide__text">
            <b>Демо без камеры.</b> Нажимай кнопки мышью или пальцем — с камерой их выбирают рукой.
          </p>
        )}
        <div className="demo-guide__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={onCamera}>
            <Icon name="camera" size={20} />
            <span className="hide-sm">Включить камеру</span>
            <span className="demo-guide__sm">С камерой</span>
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
            Выйти<span className="hide-sm"> из демо</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
