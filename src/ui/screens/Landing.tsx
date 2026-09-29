// U-04 + U-18: лендинг. Единственный клик в приложении — «Начать»: браузеру нужен жест,
// чтобы дать камеру и звук. Дальше всё управляется телом.
// Первый экран: заголовок, фото атлета и парящий экран с живым HUD; ниже — технологии, упражнения,
// режим «ошибка», призыв.

import { useRef, type ReactNode } from 'react';
import { FORM_ERRORS } from '../../engine/hints';
import { EXERCISES } from '../../engine/types';
import { Ghost } from '../components/Ghost';
import { Icon } from '../components/Icon';
import { LivePreview } from '../components/LivePreview';
import { EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import { useCountUp } from '../lib/useCountUp';
import { useReveal } from '../lib/useReveal';
import { generateNames } from '../store/progress';
import './Landing.css';

const ERROR_COUNT = Object.values(FORM_ERRORS).reduce((a, list) => a + list.length, 0);
const HERO_PHOTO = `${import.meta.env.BASE_URL}landing/hero-athlete.jpg`;

/** Витрина ошибок: самые частые на каждое упражнение. */
const SHOWCASE = [
  { exercise: 'squat', code: 'shallow_depth' },
  { exercise: 'squat', code: 'knees_in' },
  { exercise: 'jumping_jack', code: 'arms_low' },
  { exercise: 'lunge', code: 'back_knee_high' },
  { exercise: 'squat', code: 'torso_lean' },
  { exercise: 'arm_raise', code: 'elbows_bent' },
] as const;

/** Пример таблицы рекордов для карточки «Соревнуйся» (имена — тем же генератором, что в приложении). */
const SAMPLE_TOP = (() => {
  const [a, b, c] = generateNames(3, 4242);
  return [
    { name: a ?? 'Быстрый Барс', points: 982 },
    { name: 'Ты', points: 842, me: true },
    { name: b ?? 'Стальной Сокол', points: 801 },
    { name: c ?? 'Ловкий Тулпар', points: 760 },
  ];
})();

const ERROR_HIGHLIGHT = new Set([23, 25, 27]);

export function Landing({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  const scrollTo = (id: string) =>
    root.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <main ref={root} className="landing">
      <nav className="lnav">
        <span className="lnav__logo">FORMA</span>
        <div className="lnav__links">
          <button type="button" onClick={() => scrollTo('tech')}>
            Возможности
          </button>
          <button type="button" onClick={() => scrollTo('exercises')}>
            Упражнения
          </button>
          <button type="button" onClick={() => scrollTo('errors')}>
            Режим ошибки
          </button>
        </div>
        <button type="button" className="lbtn lbtn--sm" onClick={onStart}>
          Начать
        </button>
      </nav>

      <section className="hero">
        <div className="hero__scene" aria-hidden="true">
          <img className="hero__photo" src={HERO_PHOTO} alt="" />
          <span className="hero__streak hero__streak--a" />
          <span className="hero__streak hero__streak--b" />
          <span className="hero__glow" />
        </div>

        <div className="hero__copy">
          <p className="hero__kicker rise" style={order(0)}>
            AI Fitness Coach
          </p>
          <h1 className="hero__title">
            <Line i={0}>Тренер,</Line>
            <Line i={1}>которому</Line>
            <Line i={2} accent>
              не нужны руки
            </Line>
          </h1>
          <p className="hero__lead rise" style={order(4)}>
            Умный тренер, который видит тебя через камеру: считает повторения, исправляет ошибки техники и
            подсказывает голосом. Просто встань перед экраном — и начни тренироваться.
          </p>
          <div className="hero__cta rise" style={order(5)}>
            <button type="button" className="lbtn hero__start" onClick={onStart}>
              Начать тренировку <Icon name="back" size={22} className="lbtn__arrow" />
            </button>
            <button type="button" className="lbtn lbtn--ghost" onClick={onDemo}>
              Демо без камеры
            </button>
          </div>
          <dl className="hero__facts rise" style={order(6)}>
            <Fact
              value={EXERCISES.length}
              label="вида упражнений"
              note="Приседания, выпады, «звёздочка», подъём рук"
            />
            <Fact value={ERROR_COUNT} label="ошибок техники" note="Каждая — с конкретной подсказкой" />
            <Fact value={30} label="кадров в секунду" note="Распознавание прямо в браузере" />
          </dl>
        </div>

        <div className="hero__screen rise" style={order(3)}>
          <LivePreview />
        </div>

        <button type="button" className="hero__scroll" onClick={() => scrollTo('tech')}>
          <span>Scroll</span>
          <i />
        </button>
      </section>

      <section id="tech" className="lsec">
        <header className="lsec__head" data-reveal>
          <span className="lsec__num">01</span>
          <h2 className="lsec__title">Технологии, которые работают на тебя</h2>
          <p className="lsec__text">
            Компьютерное зрение, своя логика распознавания и точная аналитика — чтобы тренироваться правильно,
            без ошибок и травм.
          </p>
        </header>
        <ul className="tech">
          <li className="tech__card" data-reveal style={order(0)}>
            <div className="tech__viz tech__viz--track">
              <Ghost exercise="squat" className="tech__ghost" yaw={0.2} />
              <span className="tech__corner tech__corner--tl" />
              <span className="tech__corner tech__corner--tr" />
              <span className="tech__corner tech__corner--bl" />
              <span className="tech__corner tech__corner--br" />
              <span className="tech__scan" />
            </div>
            <h3>Распознаёт движения</h3>
            <p>33 точки тела, 30 раз в секунду — следит за техникой в реальном времени</p>
          </li>
          <li className="tech__card" data-reveal style={order(1)}>
            <div className="tech__viz tech__viz--error">
              <Ghost exercise="lunge" className="tech__ghost" highlight={ERROR_HIGHLIGHT} />
            </div>
            <h3>Находит ошибки</h3>
            <p>Показывает, что именно исправить: голосом, подсказкой и красным суставом</p>
          </li>
          <li className="tech__card" data-reveal style={order(2)}>
            <div className="tech__viz tech__viz--score">
              <div className="tech__score">
                <ScoreLoop />
                <span className="tech__check">
                  <Icon name="check" size={30} />
                </span>
              </div>
            </div>
            <h3>Считает и оценивает</h3>
            <p>Оценка каждого повтора, процент чистой техники и прогресс</p>
          </li>
          <li className="tech__card" data-reveal style={order(3)}>
            <div className="tech__viz tech__viz--top">
              <b className="tech__top-title">Топ 10</b>
              <ol className="tech__top">
                {SAMPLE_TOP.map((r, i) => (
                  <li key={r.name} className={r.me ? 'is-me' : ''}>
                    <span>{i + 1}</span>
                    <span>{r.name}</span>
                    <b>{r.points}</b>
                  </li>
                ))}
              </ol>
            </div>
            <h3>Соревнуйся</h3>
            <p>Таблица рекордов, серии чистых повторов и челлендж на 60 секунд</p>
          </li>
        </ul>
      </section>

      <section id="exercises" className="lsec">
        <header className="lsec__head" data-reveal>
          <span className="lsec__num">02</span>
          <h2 className="lsec__title">Четыре упражнения — идеальная техника</h2>
          <p className="lsec__text">
            Перед каждым подходом тренер показывает эталон: движение построено на пропорциях реального
            человека.
          </p>
        </header>
        <ul className="moves">
          {EXERCISES.map((ex, i) => (
            <li key={ex} className="move" data-reveal style={order(i)}>
              <Ghost exercise={ex} className="move__ghost" />
              <div className="move__text">
                <h3>{EXERCISE_META[ex].title}</h3>
                <p>{EXERCISE_META[ex].cues.join(' · ')}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section id="errors" className="lsec lsec--split">
        <header className="lsec__head" data-reveal>
          <span className="lsec__num">03</span>
          <h2 className="lsec__title">Не «движение не распознано», а что именно исправить</h2>
          <p className="lsec__text">
            {ERROR_COUNT} ошибок техники. Каждую тренер показывает сразу четырьмя способами: подсказкой на
            экране, голосом, красными суставами на твоём скелете и стрелкой — куда двигаться.
          </p>
        </header>
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
        <span className="final__glow" aria-hidden="true" />
        <h2>Готов? Отойди на пару шагов от экрана</h2>
        <button type="button" className="lbtn hero__start" onClick={onStart}>
          Начать тренировку <Icon name="back" size={22} className="lbtn__arrow" />
        </button>
        <p>Видео не покидает устройство: распознавание работает прямо в браузере.</p>
      </section>

      <footer className="lfoot">
        <span className="lnav__logo">FORMA</span>
        <span>ADMIT Hackathon 2026 · Motion: камера вместо джойстика</span>
      </footer>
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

function Fact({ value, label, note }: { value: number; label: string; note: string }) {
  const n = useCountUp(value, 1100, 800);
  return (
    <div className="hero__fact">
      <dt>{n}</dt>
      <dd>
        <b>{label}</b>
        <span>{note}</span>
      </dd>
    </div>
  );
}

/** «+96» в карточке оценки: число набегает и повторяется. */
function ScoreLoop() {
  const n = useCountUp(96, 1400, 600);
  return <span className="tech__score-num">+{n}</span>;
}
