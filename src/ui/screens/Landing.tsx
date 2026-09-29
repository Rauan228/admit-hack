// U-04: лендинг — минимализм: один экран с главным, один 3D-атлет, три шага, режимы. Платформа — на /app.
// Единственный клик — «Начать»: браузеру нужен жест, чтобы дать камеру и звук. Дальше всё управляется телом.

import { useEffect, useState } from 'react';
import { EXERCISES } from '../../engine/types';
import { Ghost } from '../components/Ghost';
import { Icon } from '../components/Icon';
import { MUSCLE_NAMES, type GhostId } from '../lib/athlete';
import { EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import './Landing.css';

/** Сколько атлет показывает одно упражнение, прежде чем перейти к следующему. */
const SHOW_MS = 7000;
/** Что показывает атлет: упражнения платформы и бёрпи — эталон уже готов, распознавание на подходе. */
const SHOWCASE: GhostId[] = [...EXERCISES, 'burpee'];
const TITLE = (ex: GhostId) => (ex === 'burpee' ? 'Бёрпи' : EXERCISE_META[ex].title);

const STEPS = [
  { n: '01', title: 'Встань', text: 'Камера находит 33 точки тела — ничего не нужно надевать.' },
  { n: '02', title: 'Двигайся', text: 'Повторения считаются сами, каждое получает оценку.' },
  { n: '03', title: 'Исправляй', text: 'Ошибся — сразу слышишь, что именно поправить.' },
];

const MODES = ['Быстрая тренировка', 'Одно упражнение', 'Челлендж 60 с'];

export function Landing({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  const [shown, setShown] = useState<GhostId>(SHOWCASE[0]!);
  const reduced =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      setShown((ex) => SHOWCASE[(SHOWCASE.indexOf(ex) + 1) % SHOWCASE.length]!);
    }, SHOW_MS);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <main className="landing">
      <nav className="lnav">
        <span className="lnav__logo">FORMA</span>
        <button type="button" className="lbtn lbtn--quiet" onClick={onStart}>
          Начать
        </button>
      </nav>

      <section className="hero">
        <div className="hero__copy">
          <p className="hero__kicker rise" style={order(0)}>
            AI-тренер в браузере
          </p>
          <h1 className="hero__title rise" style={order(1)}>
            Тренер, который <em>видит</em> технику
          </h1>
          <p className="hero__lead rise" style={order(2)}>
            Встань перед камерой — FORMA считает повторения и сразу говорит, что исправить.
          </p>
          <div className="hero__cta rise" style={order(3)}>
            <button type="button" className="lbtn" onClick={onStart}>
              Начать тренировку <Icon name="play" size={18} />
            </button>
            <button type="button" className="lbtn lbtn--ghost" onClick={onDemo}>
              Демо без камеры
            </button>
          </div>
          <p className="hero__note rise" style={order(4)}>
            Без установки · видео не покидает устройство
          </p>
        </div>

        <figure className="hero__stage rise" style={order(2)}>
          <Ghost key={shown} exercise={shown} className="hero__ghost" sway />
          <figcaption className="hero__caption">
            <b>{TITLE(shown)}</b>
            <span>{MUSCLE_NAMES[shown].join(' · ')}</span>
          </figcaption>
          <div className="hero__dots" aria-hidden="true">
            {SHOWCASE.map((ex) => (
              <span key={ex} className={ex === shown ? 'is-on' : ''} />
            ))}
          </div>
        </figure>
      </section>

      <section className="steps" aria-label="Как это работает">
        {STEPS.map((s) => (
          <article key={s.n} className="step">
            <span className="step__n">{s.n}</span>
            <h2>{s.title}</h2>
            <p>{s.text}</p>
          </article>
        ))}
      </section>

      <section className="modes">
        <p className="modes__label">Режимы</p>
        <ul>
          {MODES.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="modes__text">Общий рейтинг и личные рекорды — в зачёт идут только чистые повторения.</p>
      </section>

      <footer className="lfoot">
        <span className="lnav__logo">FORMA</span>
        <span>ADMIT Hackathon 2026</span>
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
