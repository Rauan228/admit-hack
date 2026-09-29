// U-16: загрузка. Модель с CDN при первом заходе грузится 6–20 с — объясняем, что происходит.

import { useEffect, useState } from 'react';
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
      <div className="loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h2 className="status__title">{mock ? 'Запускаем демо…' : STEPS[step]}</h2>
      {!mock && (
        <p className="status__text muted">
          {slow
            ? 'Дольше обычного. Проверь интернет: модель скачивается один раз, потом открывается быстро.'
            : 'Разреши доступ к камере, если браузер спросит. Первый запуск — до 20 секунд.'}
        </p>
      )}
    </main>
  );
}
