// U-04 + U-18: лендинг. Единственный клик в приложении — «Начать»: браузеру нужен жест,
// чтобы дать камеру и звук. Дальше всё управляется телом.
// Первый экран: заголовок, фото атлета и парящий экран с живым HUD. Ниже коротко: как работает (3 карточки),
// все упражнения по категориям, три примера режима «ошибка», призыв. 3D-атлет на странице один — в карточке.

import { useRef, type ReactNode } from 'react';
import { FORM_ERRORS } from '../../engine/hints';
import { EXERCISES } from '../../engine/types';
import { Icon, type IconName } from '../components/Icon';
import { LivePreview } from '../components/LivePreview';
import { CATEGORIES, EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import { useCountUp } from '../lib/useCountUp';
import { useReveal } from '../lib/useReveal';
import './Landing.css';

const ERROR_COUNT = Object.values(FORM_ERRORS).reduce((a, list) => a + list.length, 0);
const HERO_PHOTO = `${import.meta.env.BASE_URL}landing/hero-athlete.jpg`;

/** Три примера режима «ошибка». */
const SHOWCASE = [
  { exercise: 'squat', code: 'knees_in' },
  { exercise: 'jumping_jack', code: 'arms_low' },
  { exercise: 'lunge', code: 'back_knee_high' },
] as const;

const HOW: { icon: IconName; title: string; text: string }[] = [
  { icon: 'camera', title: 'Видит', text: '33 точки тела, 30 раз в секунду — прямо в браузере' },
  { icon: 'alert', title: 'Поправляет', text: 'Что именно исправить — на экране и голосом' },
  { icon: 'trophy', title: 'Соревнуется', text: 'Рейтинг и личные рекорды — только чистые повторы' },
];

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
            Встань перед камерой — FORMA считает повторения и сразу подсказывает, что исправить.
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
            <Fact value={EXERCISES.length} label="упражнений" />
            <Fact value={ERROR_COUNT} label="ошибок техники" />
            <Fact value={30} label="кадров в секунду" />
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

      <section id="tech" className="lsec lsec--row">
        <header className="lsec__head" data-reveal>
          <span className="lsec__num">01</span>
          <h2 className="lsec__title">Как это работает</h2>
        </header>
        <ul className="how">
          {HOW.map((h, i) => (
            <li key={h.title} className="how__card" data-reveal style={order(i)}>
              <span className="how__icon">
                <Icon name={h.icon} size={26} />
              </span>
              <h3>{h.title}</h3>
              <p>{h.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="exercises" className="lsec lsec--row">
        <header className="lsec__head" data-reveal>
          <span className="lsec__num">02</span>
          <h2 className="lsec__title">{EXERCISES.length} упражнений</h2>
        </header>
        <div className="cats">
          {CATEGORIES.map((c, i) => (
            <div key={c.id} className="cats__row" data-reveal style={order(i)}>
              <b>{c.title}</b>
              <ul>
                {c.items.map((ex) => (
                  <li key={ex}>{EXERCISE_META[ex].title}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section id="errors" className="lsec lsec--row">
        <header className="lsec__head" data-reveal>
          <span className="lsec__num">03</span>
          <h2 className="lsec__title">Не «движение не распознано» — а что исправить</h2>
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
        <h2>Готов? Отойди на пару шагов</h2>
        <button type="button" className="lbtn hero__start" onClick={onStart}>
          Начать тренировку <Icon name="back" size={22} className="lbtn__arrow" />
        </button>
        <p>Видео не покидает устройство: распознавание работает прямо в браузере.</p>
      </section>

      <footer className="lfoot">
        <span className="lnav__logo">FORMA</span>
        <span>ADMIT Hackathon 2026 · Motion: камера вместо джойстика</span>
        <span>
          3D-анатомия:{' '}
          <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" target="_blank" rel="noreferrer">
            Z-Anatomy
          </a>{' '}
          и BodyParts3D, CC BY-SA 4.0
        </span>
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

function Fact({ value, label }: { value: number; label: string }) {
  const n = useCountUp(value, 1100, 800);
  return (
    <div className="hero__fact">
      <dt>{n}</dt>
      <dd>
        <b>{label}</b>
      </dd>
    </div>
  );
}
