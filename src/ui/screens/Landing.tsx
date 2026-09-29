// U-04: лендинг «Технологичный атлас» — FORMA выглядит как система анализа тела, а не фитнес-приложение.
// Первый экран: слева оффер, в центре анатомический атлет на технической сетке с выносками мышц, справа HUD,
// синхронный с движением атлета (оценка, счёт, «чистое повторение» / ошибка). Ниже: Встань → Двигайся →
// Исправляй → Анализируй, 18 упражнений, режим «ошибка», режимы и рейтинг, призыв. 3D-атлет на странице один.
// Единственный клик в приложении — «Начать»: браузеру нужен жест, чтобы дать камеру и звук.

import { useEffect, useRef, useState } from 'react';
import { FORM_ERRORS } from '../../engine/hints';
import { EXERCISES } from '../../engine/types';
import { Ghost } from '../components/Ghost';
import { Icon } from '../components/Icon';
import { durationOf } from '../lib/athlete';
import { CATEGORIES, EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import { useCountUp } from '../lib/useCountUp';
import { useReveal } from '../lib/useReveal';
import './Landing.css';

const ERROR_COUNT = Object.values(FORM_ERRORS).reduce((a, list) => a + list.length, 0);
/** Каждый четвёртый повтор в витрине — с ошибкой «колени внутрь»: так видно режим «ошибка». */
const ERROR_EVERY = 4;
const TARGET = 15;
const KNEES = new Set([23, 24, 25, 26]);

const STEPS = [
  { n: '01', title: 'Встань', text: 'Камера находит тело и строит скелет из 33 точек.' },
  { n: '02', title: 'Двигайся', text: 'Повторения считаются сами, каждое получает оценку.' },
  { n: '03', title: 'Исправляй', text: 'Ошибка — сразу подсказка: что и куда поправить.' },
  { n: '04', title: 'Анализируй', text: 'Итоги, процент чистой техники и рекорды.' },
];

const ERRORS = [
  { exercise: 'squat', code: 'knees_in' },
  { exercise: 'squat', code: 'shallow_depth' },
  { exercise: 'jumping_jack', code: 'arms_low' },
] as const;

const MODES = [
  { title: 'Быстрая тренировка', meta: '3 мин · 3 упражнения' },
  { title: 'Одно упражнение', meta: `${EXERCISES.length} на выбор` },
  { title: 'Челлендж 60 секунд', meta: 'максимум чистых приседаний' },
  { title: 'Дуэль отжиманий', meta: 'соревнуйся с соперником' },
];

/** Пример таблицы — в приложении она настоящая (сервер, «сегодня / неделя / всё время»). */
const SAMPLE_TOP = [
  { name: 'Ты', score: 2419, me: true },
  { name: 'Алия', score: 2187 },
  { name: 'Дамир', score: 1982 },
  { name: 'Карина', score: 1760 },
];

export function Landing({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  const scrollTo = (id: string) =>
    root.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth' });

  // Общие часы для атлета и HUD: повтор атлета = повтор на счётчике.
  const [clock] = useState(() => {
    const t0 = performance.now();
    return () => performance.now() - t0;
  });
  const rep = useRep(clock);
  const bad = rep.n > 0 && rep.n % ERROR_EVERY === 0;

  return (
    <main ref={root} className="landing">
      <nav className="lnav">
        <span className="lnav__logo">FORMA</span>
        <div className="lnav__links">
          <button type="button" onClick={() => scrollTo('how')}>
            Как работает
          </button>
          <button type="button" onClick={() => scrollTo('exercises')}>
            Упражнения
          </button>
          <button type="button" onClick={() => scrollTo('modes')}>
            Режимы
          </button>
        </div>
        <button type="button" className="lbtn lbtn--sm" onClick={onStart}>
          Начать
        </button>
      </nav>

      <section className="hero">
        <div className="hero__copy">
          <p className="tag rise" style={order(0)}>
            AI · computer vision · real-time
          </p>
          <h1 className="hero__title rise" style={order(1)}>
            Тренер, который видит технику
          </h1>
          <p className="hero__lead rise" style={order(2)}>
            Встань перед камерой — FORMA считает повторения и подсказывает, что поправить.
          </p>
          <div className="hero__cta rise" style={order(3)}>
            <button type="button" className="lbtn" onClick={onStart}>
              Начать тренировку <Icon name="back" size={18} className="lbtn__arrow" />
            </button>
            <button type="button" className="lbtn lbtn--ghost" onClick={onDemo}>
              Демо без камеры
            </button>
          </div>
          <dl className="hero__facts rise" style={order(4)}>
            <Fact value={EXERCISES.length} label="упражнений" />
            <Fact value={ERROR_COUNT} label="ошибок техники" />
            <Fact value={30} label="кадров в секунду" />
          </dl>
        </div>

        <figure className="atlas rise" style={order(2)} aria-hidden="true">
          <span className="atlas__corner atlas__corner--tl" />
          <span className="atlas__corner atlas__corner--tr" />
          <span className="atlas__corner atlas__corner--bl" />
          <span className="atlas__corner atlas__corner--br" />
          <span className="atlas__axis atlas__axis--x" />
          <span className="atlas__axis atlas__axis--y" />
          <Ghost
            exercise="squat"
            yaw={0.5}
            clock={clock}
            highlight={bad ? KNEES : undefined}
            className="atlas__ghost"
          />
          <Callout className="atlas__call--delts" name="Deltoid" ru="дельты" value="стабилизация" />
          <Callout
            className="atlas__call--quads"
            name="Quadriceps"
            ru="квадрицепсы"
            value={`нагрузка ${Math.round(40 + 55 * rep.depth)}%`}
            bad={bad}
          />
          <Callout className="atlas__call--glutes" name="Gluteus" ru="ягодичные" value="активны" />
          <Callout className="atlas__call--calf" name="Calf" ru="икры" value="опора" />
          <figcaption className="atlas__meta">
            <span>pose · 33 kp</span>
            <span>squat · rep {String(rep.n).padStart(2, '0')}</span>
          </figcaption>
        </figure>

        <aside className="hud rise" style={order(3)} aria-label="Пример анализа повтора">
          <div className={`hud__ring ${bad ? 'is-bad' : 'is-good'}`}>
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" className="hud__track" />
              <circle
                cx="50"
                cy="50"
                r="44"
                pathLength="100"
                className="hud__fill"
                style={{ strokeDasharray: `${rep.score} 100` }}
              />
            </svg>
            <b>+{rep.score}</b>
            <small>оценка техники</small>
          </div>
          <div className="hud__row">
            <span className="tag">повторы</span>
            <b>
              {Math.min(rep.n, TARGET)} <small>/ {TARGET}</small>
            </b>
          </div>
          <div className={`hud__state ${bad ? 'is-bad' : 'is-good'}`} key={rep.n}>
            <Icon name={bad ? 'alert' : 'check'} size={18} />
            {bad ? 'Колени внутрь — разведи по носкам' : 'Чистое повторение'}
          </div>
          <p className="tag hud__foot">real-time analysis</p>
        </aside>
      </section>

      <section id="how" className="lsec">
        <header className="lsec__head" data-reveal>
          <span className="tag">01 / механика</span>
          <h2>Как это работает</h2>
        </header>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.n} className="step" data-reveal style={order(i)}>
              <span className="step__n">{s.n}</span>
              <StepFigure i={i} />
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="exercises" className="lsec">
        <header className="lsec__head" data-reveal>
          <span className="tag">02 / каталог</span>
          <h2>{EXERCISES.length} упражнений в 4 категориях</h2>
        </header>
        <div className="cats">
          {CATEGORIES.map((c, i) => (
            <article key={c.id} className="panel cat" data-reveal style={order(i)}>
              <header>
                <Icon name={c.icon} size={20} className="primary" />
                <h3>{c.title}</h3>
                <span className="tag">{c.items.length}</span>
              </header>
              <ul>
                {c.items.map((ex) => (
                  <li key={ex}>{EXERCISE_META[ex].title}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section id="modes" className="lsec lsec--split">
        <div>
          <header className="lsec__head" data-reveal>
            <span className="tag">03 / режим «ошибка»</span>
            <h2>Не «движение не распознано», а что исправить</h2>
          </header>
          <ul className="errs">
            {ERRORS.map((s, i) => {
              const def = FORM_ERRORS[s.exercise].find((e) => e.code === s.code);
              if (!def) return null;
              return (
                <li
                  key={`${s.exercise}-${s.code}`}
                  className={`panel err err--${def.severity}`}
                  data-reveal
                  style={order(i)}
                >
                  <span className="err__dot" />
                  <div>
                    <b>{def.message}</b>
                    <span className="tag">{EXERCISE_META[s.exercise].title}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <header className="lsec__head" data-reveal>
            <span className="tag">04 / соревнование</span>
            <h2>Режимы и рейтинг</h2>
          </header>
          <div className="modes">
            <ul className="modes__list">
              {MODES.map((m, i) => (
                <li key={m.title} className="panel" data-reveal style={order(i)}>
                  <b>{m.title}</b>
                  <span className="tag">{m.meta}</span>
                </li>
              ))}
            </ul>
            <div className="panel top" data-reveal>
              <div className="top__head">
                <b>Рейтинг</b>
                <span className="tag">сегодня · неделя · всё время</span>
              </div>
              <ol>
                {SAMPLE_TOP.map((r, i) => (
                  <li key={r.name} className={r.me ? 'is-me' : ''}>
                    <span>{i + 1}</span>
                    <span>{r.name}</span>
                    <b>{r.score.toLocaleString('ru-RU')}</b>
                  </li>
                ))}
              </ol>
              <p className="tag">в зачёт — только чистые повторения</p>
            </div>
          </div>
        </div>
      </section>

      <section className="final" data-reveal>
        <span className="tag">ready · step back 2–3 m</span>
        <h2>Готов? Отойди на пару шагов</h2>
        <button type="button" className="lbtn" onClick={onStart}>
          Начать тренировку <Icon name="back" size={18} className="lbtn__arrow" />
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

/** Счётчик повторов витрины по тем же часам, что и атлет: номер повтора, глубина (0..1), оценка. */
function useRep(clock: () => number) {
  const dur = durationOf('squat');
  const [state, setState] = useState({ n: 0, depth: 0, score: 96 });
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const tick = () => {
      if (reduced) return setState({ n: 12, depth: 0.8, score: 95 });
      const t = clock();
      const n = Math.floor(t / dur);
      const u = (t % dur) / dur;
      const depth = Math.sin(Math.PI * Math.min(1, u / 0.9));
      const bad = n > 0 && n % ERROR_EVERY === 0;
      const score = bad ? 64 : 92 + ((n * 7) % 7);
      setState((s) => (s.n === n && Math.abs(s.depth - depth) < 0.05 ? s : { n, depth, score }));
    };
    const id = setInterval(tick, reduced ? 60_000 : 120);
    return () => clearInterval(id);
  }, [clock, dur]);
  return state;
}

function Callout({
  className,
  name,
  ru,
  value,
  bad,
}: {
  className: string;
  name: string;
  ru: string;
  value: string;
  bad?: boolean;
}) {
  return (
    <span className={`atlas__call ${className} ${bad ? 'is-bad' : ''}`}>
      <i />
      <b>{name}</b>
      <small>
        {ru} · {value}
      </small>
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

type XY = readonly [number, number];

/** Схемы шагов: скелет из точек и линий, как в инженерном интерфейсе. 01 стойка, 02 присед, 03 ошибка, 04 график. */
function StepFigure({ i }: { i: number }) {
  if (i === 3)
    return (
      <svg viewBox="0 0 100 100" className="step__fig">
        <path d="M8 86 H92 M8 86 V14" className="fig__grid" />
        <polyline points="12,70 26,58 40,62 54,40 68,46 82,24 90,28" className="fig__line" />
        {(
          [
            [26, 58],
            [54, 40],
            [82, 24],
          ] as XY[]
        ).map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="3" className="fig__dot fig__dot--good" />
        ))}
      </svg>
    );
  const squat = i > 0;
  const head: XY = squat ? [50, 26] : [50, 14];
  const sh: XY = squat ? [50, 38] : [50, 26];
  const hip: XY = squat ? [50, 62] : [50, 52];
  const lk: XY = squat ? (i === 2 ? [46, 72] : [36, 70]) : [42, 70];
  const rk: XY = squat ? [64, 70] : [58, 70];
  const la: XY = squat ? [34, 44] : [36, 40];
  const ra: XY = squat ? [66, 44] : [64, 40];
  const lf: XY = [40, 90];
  const rf: XY = [60, 90];
  const bones: [XY, XY, boolean][] = [
    [sh, hip, false],
    [sh, la, false],
    [sh, ra, false],
    [hip, lk, i === 2],
    [lk, lf, i === 2],
    [hip, rk, false],
    [rk, rf, false],
  ];
  return (
    <svg viewBox="0 0 100 100" className="step__fig">
      <path d="M20 94 H80" className="fig__grid" />
      {i === 0 && <rect x="26" y="6" width="48" height="90" className="fig__frame" />}
      <circle cx={head[0]} cy={head[1]} r="6" className="fig__head" />
      {bones.map(([a, b, bad], k) => (
        <line
          key={k}
          x1={a[0]}
          y1={a[1]}
          x2={b[0]}
          y2={b[1]}
          className={bad ? 'fig__line fig__line--bad' : 'fig__line'}
        />
      ))}
      {[sh, hip, lk, rk, lf, rf].map((p, k) => {
        const bad = i === 2 && p === lk;
        return (
          <circle
            key={k}
            cx={p[0]}
            cy={p[1]}
            r={bad ? 4 : 2.4}
            className={bad ? 'fig__dot fig__dot--bad' : 'fig__dot'}
          />
        );
      })}
    </svg>
  );
}
