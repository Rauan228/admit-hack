// U-12: интро упражнения — 3D-атлет показывает правильное движение. Камера уже включена (второй подход плана) —
// сам отсчёт 3-2-1; камеры нет — ждём «Старт»: он включит камеру и вернёт сюда же, уже с отсчётом.
// «Обе руки вверх» здесь не работает: человек часто повторяет за атлетом (а в «звёздочке» руки вверху).
// Проверено живьём 30.09: старт по этому жесту запускал подход от обычных прыжков — вернули отсчёт.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { numberWord, say } from '../audio/voice';
import { sfx } from '../audio/sfx';
import { DwellButton } from '../components/dwell';
import { Ghost } from '../components/Ghost';
import { Icon } from '../components/Icon';
import { MUSCLE_NAMES } from '../lib/athlete';
import { EXERCISE_META, type Plan } from '../lib/exercises';
import { order } from '../lib/motion';
import './Intro.css';

const DEMO_MS = 3600;

export function Intro({
  plan,
  index,
  onGo,
  onBack,
  camera = true,
}: {
  plan: Plan;
  index: number;
  onGo: () => void;
  onBack: () => void;
  /** Камера уже работает: отсчёт идёт сам. */
  camera?: boolean;
}) {
  const item = plan.items[index] ?? plan.items[0]!;
  const meta = EXERCISE_META[item.exercise];
  const next = plan.items[index + 1];
  const [count, setCount] = useState<number | null>(null);
  const goRef = useRef(onGo);
  useLayoutEffect(() => {
    goRef.current = onGo;
  });

  useEffect(() => {
    say(`${index > 0 ? 'Следующее: ' : ''}${meta.title}. ${meta.cues[0]}.`, 'info');
    if (!camera) return;
    const timers = [
      setTimeout(() => setCount(3), DEMO_MS),
      setTimeout(() => setCount(2), DEMO_MS + 1000),
      setTimeout(() => setCount(1), DEMO_MS + 2000),
      setTimeout(() => goRef.current(), DEMO_MS + 3000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [index, meta, camera]);

  useEffect(() => {
    if (count === null) return;
    sfx.tick();
    say(numberWord(count), 'hint');
  }, [count]);

  const goal = plan.timeLimitSec
    ? `${plan.timeLimitSec} секунд`
    : item.exercise === 'lunge'
      ? `${item.target} × обе ноги`
      : meta.unit === 'sec'
        ? `${item.target} секунд`
        : `${item.target} повторений`;

  return (
    <main className="page intro">
      <div className="page__inner intro__grid">
        <section className="intro__stage">
          <Ghost exercise={item.exercise} className="intro__canvas" />
        </section>

        <section className="intro__copy">
          <button type="button" className="back-link" onClick={onBack}>
            <Icon name="back" size={16} /> В меню
          </button>
          {plan.items.length > 1 && (
            <span className="tag">
              Упражнение {index + 1} из {plan.items.length}
            </span>
          )}
          <h1 className="intro__title rise" style={order(0)}>
            {meta.title}
          </h1>
          <div className="intro__chips rise" style={order(1)}>
            <span className="intro__goal">
              <Icon name="target" size={16} /> {goal}
            </span>
            {plan.timeLimitSec && <span className="intro__chip">максимум чистых</span>}
          </div>

          <ol className="intro__cues">
            {meta.cues.map((c, i) => (
              <li key={c} className="rise" style={order(i + 2)}>
                <span>{i + 1}</span> {c}
              </li>
            ))}
          </ol>

          <p className="muscles rise" style={order(5)}>
            <i aria-hidden="true" /> {MUSCLE_NAMES[item.exercise].join(' · ')}
          </p>
          {meta.setup && (
            <p className="intro__setup rise" style={order(5)}>
              <Icon name="camera" size={18} /> {meta.setup}
            </p>
          )}

          {next && (
            <p className="intro__next">
              <span className="tag">Далее:</span> {EXERCISE_META[next.exercise].title}
            </p>
          )}

          <div className="intro__actions rise" style={order(6)}>
            <DwellButton variant="primary" size="lg" className="intro__start" onSelect={onGo}>
              <Icon name="play" size={18} /> {camera ? 'Начать сейчас' : 'Старт'}
            </DwellButton>
            <p className="intro__note">
              {camera
                ? 'Старт через пару секунд — встань в кадр.'
                : 'Включим камеру: встань в 2–3 метрах, чтобы было видно целиком.'}
              {meta.handsUpToFinish && ' Обе руки над головой — закончить подход раньше.'}
            </p>
          </div>
        </section>
      </div>

      {count !== null && (
        <div className="intro__count" key={count} aria-live="assertive">
          <svg viewBox="0 0 100 100" className="intro__count-ring" aria-hidden="true">
            <circle cx="50" cy="50" r="46" pathLength="1" />
          </svg>
          <span>{count}</span>
        </div>
      )}
    </main>
  );
}
