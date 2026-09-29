// U-12: интро упражнения — «призрак» показывает правильное движение, затем отсчёт 3-2-1.
// «Обе руки вверх» здесь не работает: человек часто повторяет за призраком (а в «звёздочке» руки вверху).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { numberWord, say } from '../audio/voice';
import { sfx } from '../audio/sfx';
import { DwellButton } from '../components/dwell';
import { Ghost } from '../components/Ghost';
import { Icon } from '../components/Icon';
import { EXERCISE_META, type Plan } from '../lib/exercises';
import { order } from '../lib/motion';
import './Intro.css';

const DEMO_MS = 3600;

export function Intro({
  plan,
  index,
  onGo,
  onBack,
}: {
  plan: Plan;
  index: number;
  onGo: () => void;
  onBack: () => void;
}) {
  const item = plan.items[index] ?? plan.items[0]!;
  const meta = EXERCISE_META[item.exercise];
  const [count, setCount] = useState<number | null>(null);
  const goRef = useRef(onGo);
  useLayoutEffect(() => {
    goRef.current = onGo;
  });

  useEffect(() => {
    say(`${index > 0 ? 'Следующее: ' : ''}${meta.title}. ${meta.cues[0]}.`, 'info');
    const timers = [
      setTimeout(() => setCount(3), DEMO_MS),
      setTimeout(() => setCount(2), DEMO_MS + 1000),
      setTimeout(() => setCount(1), DEMO_MS + 2000),
      setTimeout(() => goRef.current(), DEMO_MS + 3000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [index, meta]);

  useEffect(() => {
    if (count === null) return;
    sfx.tick();
    say(numberWord(count), 'hint');
  }, [count]);

  const goal = plan.timeLimitSec
    ? `${plan.timeLimitSec} секунд — максимум чистых повторов`
    : item.exercise === 'lunge'
      ? `Цель: ${item.target} × обе ноги`
      : `Цель: ${item.target} повторений`;

  return (
    <main className="screen intro">
      <section className="intro__ghost card">
        <Ghost exercise={item.exercise} className="intro__canvas" />
        <span className="eyebrow eyebrow--muted intro__ghost-label">Смотри и повторяй</span>
      </section>

      <section className="intro__copy">
        {plan.items.length > 1 && (
          <span className="eyebrow">
            Упражнение {index + 1} из {plan.items.length}
          </span>
        )}
        <h1 className="intro__title rise" style={order(0)}>
          {meta.title}
        </h1>
        <p className="intro__goal rise" style={order(1)}>
          {goal}
        </p>
        <ul className="intro__cues">
          {meta.cues.map((c, i) => (
            <li key={c} className="rise" style={order(i + 2)}>
              <Icon name="check" size={26} className="primary" /> {c}
            </li>
          ))}
        </ul>
        {meta.handsUpToFinish && (
          <p className="muted intro__note">Обе руки над головой — закончить подход раньше</p>
        )}
        <DwellButton size="sm" variant="ghost" onSelect={onBack}>
          <Icon name="back" size={22} /> В меню
        </DwellButton>
      </section>

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
