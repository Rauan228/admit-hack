// U-04 + U-18: лендинг. Единственный клик в приложении — «Начать»: браузеру нужен жест,
// чтобы дать камеру и звук. Дальше всё управляется телом.
// Первый экран помещается в окно целиком; ниже — как это работает, режим «ошибка», призыв.

import { useRef, type ReactNode } from 'react';
import { FORM_ERRORS } from '../../engine/hints';
import { EXERCISES } from '../../engine/types';
import { Icon, type IconName } from '../components/Icon';
import { LivePreview } from '../components/LivePreview';
import { Logo } from '../components/TopBar';
import { EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import { useCountUp } from '../lib/useCountUp';
import { useReveal } from '../lib/useReveal';
import './Landing.css';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'camera',
    title: 'Встань перед камерой',
    text: 'В 2–3 метрах, чтобы в кадр попали голова и стопы. Тренер сам скажет, если что-то не так.',
  },
  {
    icon: 'hand',
    title: 'Подними руку',
    text: 'Появится курсор. Задержи его на кнопке 1,2 секунды — это выбор. Обе руки вверх — назад.',
  },
  {
    icon: 'zap',
    title: 'Тренируйся',
    text: 'Счёт повторов, оценка каждого, подсказки голосом. В конце — итоги и рекорды.',
  },
];

const ERROR_COUNT = Object.values(FORM_ERRORS).reduce((a, list) => a + list.length, 0);

/** Витрина ошибок: самые частые на каждое упражнение. */
const SHOWCASE = [
  { exercise: 'squat', code: 'shallow_depth' },
  { exercise: 'squat', code: 'knees_in' },
  { exercise: 'jumping_jack', code: 'arms_low' },
  { exercise: 'lunge', code: 'back_knee_high' },
  { exercise: 'squat', code: 'torso_lean' },
  { exercise: 'arm_raise', code: 'elbows_bent' },
] as const;

const MARQUEE = [
  'Приседания',
  'Выпады',
  '«Звёздочка»',
  'Подъём рук',
  `${ERROR_COUNT} ошибок техники`,
  'Подсказки голосом',
  'Меню жестами',
  'Без установки',
];

export function Landing({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  const scrollTo = (id: string) =>
    root.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <main ref={root} className="landing">
      <div className="landing__bg" aria-hidden="true">
        <span className="landing__blob landing__blob--a" />
        <span className="landing__blob landing__blob--b" />
        <span className="landing__grid" />
      </div>

      <nav className="lnav">
        <Logo />
        <div className="lnav__links">
          <button type="button" onClick={() => scrollTo('how')}>
            Как работает
          </button>
          <button type="button" onClick={() => scrollTo('errors')}>
            Режим ошибки
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={onStart}>
            Начать
          </button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero__copy">
          <p className="hero__kicker rise" style={order(0)}>
            AI-тренер · веб-камера · без установки
          </p>
          <h1 className="hero__title">
            <Line i={0}>Тренер,</Line>
            <Line i={1}>которому не</Line>
            <Line i={2} accent>
              нужны руки
            </Line>
          </h1>
          <p className="hero__lead rise" style={order(4)}>
            Встань перед камерой — FORMA считает повторы, видит ошибки техники и говорит голосом, как их
            исправить. Меню тоже управляется телом.
          </p>
          <div className="hero__cta rise" style={order(5)}>
            <button type="button" className="btn btn--primary btn--lg hero__start" onClick={onStart}>
              <Icon name="play" size={30} /> Начать тренировку
            </button>
            <button type="button" className="btn btn--ghost" onClick={onDemo}>
              Демо без камеры
            </button>
          </div>
          <dl className="hero__facts rise" style={order(6)}>
            <Fact value={EXERCISES.length} label="упражнения" />
            <Fact value={ERROR_COUNT} label="ошибок техники" />
            <Fact value={30} label="кадров в секунду" />
          </dl>
        </div>

        <div className="hero__visual rise" style={order(3)}>
          <LivePreview />
        </div>
      </section>

      <div className="marquee" aria-hidden="true">
        {[0, 1].map((row) => (
          <div key={row} className={`marquee__row ${row ? 'marquee__row--rev' : ''}`}>
            {[...MARQUEE, ...MARQUEE].map((w, i) => (
              <span key={i}>
                {w}
                <i />
              </span>
            ))}
          </div>
        ))}
      </div>

      <section id="how" className="lsection">
        <h2 className="lsection__title" data-reveal>
          Три шага — и ты тренируешься
        </h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="step" data-reveal style={order(i)}>
              <span className="step__num">0{i + 1}</span>
              <span className="step__icon">
                <Icon name={s.icon} size={34} />
              </span>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="errors" className="lsection lsection--split">
        <div data-reveal>
          <h2 className="lsection__title">Не «движение не распознано», а что именно исправить</h2>
          <p className="lsection__text muted">
            {ERROR_COUNT} ошибок техники в четырёх упражнениях. Каждую тренер показывает сразу четырьмя
            способами: подсказкой на экране, голосом, красными суставами на твоём скелете и стрелкой — куда
            двигаться.
          </p>
        </div>
        <ul className="errs">
          {SHOWCASE.map((s, i) => {
            const def = FORM_ERRORS[s.exercise].find((e) => e.code === s.code);
            if (!def) return null;
            return (
              <li
                key={`${s.exercise}-${s.code}`}
                className={`err err--${def.severity}`}
                data-reveal
                style={order(i)}
              >
                <span className="err__ex">{EXERCISE_META[s.exercise].title}</span>
                <b>{def.message}</b>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="final" data-reveal>
        <h2>Готов? Отойди на пару шагов от экрана.</h2>
        <button type="button" className="btn btn--primary btn--lg hero__start" onClick={onStart}>
          <Icon name="play" size={30} /> Начать
        </button>
        <p className="muted">Видео не покидает устройство: распознавание работает прямо в браузере.</p>
      </section>

      <footer className="lfoot muted">FORMA · ADMIT Hackathon 2026 · Motion: камера вместо джойстика</footer>
    </main>
  );
}

function Line({ i, accent, children }: { i: number; accent?: boolean; children: ReactNode }) {
  return (
    <span className="hero__line">
      <span className={accent ? 'primary' : undefined} style={order(i)}>
        {children}
      </span>
    </span>
  );
}

function Fact({ value, label }: { value: number; label: string }) {
  const n = useCountUp(value, 1100, 800);
  return (
    <div className="hero__fact">
      <dt>{n}</dt>
      <dd>{label}</dd>
    </div>
  );
}
