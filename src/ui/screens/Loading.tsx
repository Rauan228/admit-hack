// U-16: загрузка. Модель с CDN при первом заходе грузится 6–20 с — объясняем, что происходит.

import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import './status.css';

const STEPS = ['Включаем камеру…', 'Загружаем модель распознавания…', 'Почти готово…'];

export function Loading({ mock }: { mock: boolean }) {
  const [step, setStep] = useState(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const a = setTimeout(() => setStep(1), 1500);
    const b = setTimeout(() => setStep(2), 9000);
    const c = setTimeout(() => setSlow(true), 22000);
    return () => [a, b, c].forEach(clearTimeout);
  }, []);

  return (
    <main className="screen screen--center status" aria-busy="true" aria-live="polite">
      <div className="status__panel">
        <div className="loader" aria-hidden="true">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" className="loader__track" />
            <circle cx="50" cy="50" r="42" pathLength="1" className="loader__arc" />
          </svg>
          <span className="loader__icon">
            <Icon name={mock ? 'play' : step === 0 ? 'camera' : 'zap'} size={30} />
          </span>
        </div>
        {!mock && (
          <span className="status__step">
            Шаг {step + 1} из {STEPS.length}
          </span>
        )}
        <h2 className="status__title">{mock ? 'Запускаем демо…' : STEPS[step]}</h2>
        {!mock && (
          <p className={`status__text ${slow ? 'status__text--slow' : ''}`}>
            {slow
              ? 'Дольше обычного. Проверь интернет: модель скачивается один раз, потом открывается быстро.'
              : 'Разреши доступ к камере, если браузер спросит. Первый запуск — до 20 секунд.'}
          </p>
        )}
      </div>
    </main>
  );
}
