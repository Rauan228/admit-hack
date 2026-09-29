// U-04 + U-18: лендинг. Единственный клик в приложении — «Начать»: браузеру нужен жест,
// чтобы дать камеру и звук. Дальше всё управляется телом.

import { useEffect, useState, type ReactNode } from 'react';
import { FORM_ERRORS } from '../../engine/hints';
import type { ExerciseId } from '../../engine/types';
import { Ghost } from '../components/Ghost';
import { Icon, type IconName } from '../components/Icon';
import { Logo } from '../components/TopBar';
import { EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import { useCountUp } from '../lib/useCountUp';
import './Landing.css';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'camera', title: 'Встань перед камерой', text: 'В 2–3 метрах, чтобы было видно целиком' },
  { icon: 'hand', title: 'Подними руку', text: 'Появится курсор. Задержи его на кнопке — это выбор' },
  {
    icon: 'check',
    title: 'Тренируйся',
    text: 'Тренер считает повторы и подсказывает, как исправить технику',
  },
];

/** Какие упражнения по кругу показывает призрак на лендинге. */
const SHOWCASE: ExerciseId[] = ['squat', 'jumping_jack', 'lunge', 'arm_raise'];
const SHOWCASE_MS = 5600;
const ERROR_COUNT = Object.values(FORM_ERRORS).reduce((a, list) => a + list.length, 0);

export function Landing({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  const [shown, setShown] = useState(0);
  const exercise = SHOWCASE[shown % SHOWCASE.length] ?? 'squat';

  useEffect(() => {
    const id = setInterval(() => setShown((n) => n + 1), SHOWCASE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="screen landing">
      <div className="landing__bg" aria-hidden="true">
        <span className="landing__blob landing__blob--a" />
        <span className="landing__blob landing__blob--b" />
        <span className="landing__grid" />
      </div>

      <header className="landing__top">
        <Logo />
      </header>

      <section className="landing__hero">
        <div className="landing__copy">
          <h1 className="landing__title">
            <Line i={0}>Тренер,</Line>
            <Line i={1}>которому</Line>
            <Line i={2} accent>
              не нужны руки
            </Line>
          </h1>
          <p className="landing__lead rise" style={order(4)}>
            Считает приседания, выпады и «звёздочку», видит ошибки техники и говорит голосом, как их
            исправить. Меню — тоже жестами.
          </p>
          <div className="landing__cta rise" style={order(5)}>
            <button type="button" className="btn btn--primary btn--lg landing__start" onClick={onStart}>
              <Icon name="play" size={30} /> Начать
            </button>
            <button type="button" className="btn btn--ghost" onClick={onDemo}>
              Демо без камеры
            </button>
          </div>
          <dl className="landing__facts rise" style={order(6)}>
            <Fact value={SHOWCASE.length} label="упражнения" />
            <Fact value={ERROR_COUNT} label="ошибок техники" />
            <Fact value={0} label="установок" />
          </dl>
        </div>

        <div className="landing__figure" aria-hidden="true">
          <div className="landing__ring" />
          <div className="landing__ring landing__ring--inner" />
          <span key={exercise} className="landing__word">
            {EXERCISE_META[exercise].short}
          </span>
          <Ghost key={`g-${exercise}`} exercise={exercise} className="landing__ghost" />
          <span key={`n-${exercise}`} className="landing__caption">
            {EXERCISE_META[exercise].title}
          </span>
        </div>
      </section>

      <ol className="landing__steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="landing__step rise" style={order(7 + i)}>
            <span className="landing__num">{i + 1}</span>
            <Icon name={s.icon} size={30} className="primary" />
            <div>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}

function Line({ i, accent, children }: { i: number; accent?: boolean; children: ReactNode }) {
  return (
    <span className="landing__line">
      <span className={accent ? 'primary' : undefined} style={order(i)}>
        {children}
      </span>
    </span>
  );
}

function Fact({ value, label }: { value: number; label: string }) {
  const n = useCountUp(value, 1100, 700);
  return (
    <div className="landing__fact">
      <dt>{n}</dt>
      <dd>{label}</dd>
    </div>
  );
}
