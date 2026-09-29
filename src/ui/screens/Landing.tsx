// U-04: лендинг в стиле платформы — «тёмный премиум»: ровный чёрный, сплошные мягкие карточки, крупный шрифт.
// Первый экран: слева оффер, справа карточка-сцена с анатомическим атлетом на тёплом свете, подписями мышц
// и плавающей карточкой анализа, синхронной с движением атлета (оценка, счёт, «чисто» / ошибка).
// Ниже: Встань → Двигайся → Исправляй → Анализируй, 18 упражнений, режим «ошибка», режимы и рейтинг, призыв.
// Единственный клик в приложении — «Начать»: браузеру нужен жест, чтобы дать камеру и звук.

import { useEffect, useRef, useState } from 'react';
import { FORM_ERRORS, findFormError } from '../../engine/hints';
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

// ——— Витрина первого экрана: подходы по 5 повторов, четвёртый — с ошибкой, потом следующее упражнение ———
const SET = 5;
/** Номер повтора с ошибкой (с нуля): видно режим «ошибка» и что следующий уже чистый. */
const BAD_REP = 3;
/** Пауза после подхода («подход выполнен») и затухание перед сменой упражнения, мс. */
const HOLD_MS = 2000;
const FADE_MS = 420;

const LEGS = [23, 24, 25, 26, 27, 28, 31, 32];
const ARMS = [11, 12, 13, 14, 15, 16];

interface Call {
  name: string;
  ru: string;
  /** Подпись; `%` заменяется нагрузкой по глубине повтора. */
  value: string;
  side: 'l' | 'r';
  top: number;
  /** Мышца, которую касается ошибка витрины. */
  err?: boolean;
  dim?: boolean;
}

interface Show {
  ex: 'squat' | 'jumping_jack' | 'lunge' | 'arm_raise';
  code: string;
  yaw: number;
  /** Длительность одного повтора, мс (выпад в записи — обе ноги, повтор — одна). */
  rep: number;
  hl: ReadonlySet<number>;
  calls: Call[];
}

const SHOWCASE: Show[] = [
  {
    ex: 'squat',
    code: 'knees_in',
    yaw: 0.5,
    rep: durationOf('squat'),
    hl: new Set([23, 24, 25, 26]),
    calls: [
      { name: 'Deltoid', ru: 'Дельты', value: 'стабилизация', side: 'r', top: 38, dim: true },
      { name: 'Gluteus', ru: 'Ягодичные', value: 'активны', side: 'r', top: 58 },
      { name: 'Quadriceps', ru: 'Квадрицепсы', value: 'нагрузка %', side: 'l', top: 70, err: true },
      { name: 'Calf', ru: 'Икры', value: 'опора', side: 'l', top: 85, dim: true },
    ],
  },
  {
    ex: 'jumping_jack',
    code: 'arms_low',
    yaw: 0.22,
    rep: durationOf('jumping_jack'),
    hl: new Set([...ARMS]),
    calls: [
      { name: 'Deltoid', ru: 'Дельты', value: 'нагрузка %', side: 'r', top: 36, err: true },
      { name: 'Abductors', ru: 'Отводящие', value: 'активны', side: 'r', top: 53 },
      { name: 'Quadriceps', ru: 'Квадрицепсы', value: 'амортизация', side: 'l', top: 64, dim: true },
      { name: 'Calf', ru: 'Икры', value: 'толчок', side: 'l', top: 80 },
    ],
  },
  {
    ex: 'lunge',
    code: 'knee_past_toe',
    yaw: 0.75,
    rep: durationOf('lunge') / 2,
    hl: new Set(LEGS),
    calls: [
      { name: 'Deltoid', ru: 'Дельты', value: 'баланс', side: 'r', top: 36, dim: true },
      { name: 'Gluteus', ru: 'Ягодичные', value: 'активны', side: 'r', top: 55 },
      { name: 'Quadriceps', ru: 'Квадрицепсы', value: 'нагрузка %', side: 'l', top: 66, err: true },
      { name: 'Hamstrings', ru: 'Бицепс бедра', value: 'активны', side: 'l', top: 80 },
    ],
  },
  {
    ex: 'arm_raise',
    code: 'elbows_bent',
    yaw: 0.2,
    rep: durationOf('arm_raise'),
    hl: new Set(ARMS),
    calls: [
      { name: 'Trapezius', ru: 'Трапеция', value: 'активна', side: 'r', top: 24 },
      { name: 'Deltoid', ru: 'Дельты', value: 'нагрузка %', side: 'l', top: 30, err: true },
      { name: 'Core', ru: 'Корпус', value: 'стабилизация', side: 'r', top: 54, dim: true },
      { name: 'Calf', ru: 'Икры', value: 'опора', side: 'l', top: 80, dim: true },
    ],
  },
];

const segLen = (s: Show) => SET * s.rep + HOLD_MS;
const LOOP_MS = SHOWCASE.reduce((a, s) => a + segLen(s), 0);

/** Где мы в витрине по общим часам: упражнение и время внутри подхода. */
function locate(t: number) {
  let u = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
  for (let i = 0; i < SHOWCASE.length; i += 1) {
    const s = SHOWCASE[i]!;
    if (u < segLen(s)) return { i, s, u };
    u -= segLen(s);
  }
  return { i: 0, s: SHOWCASE[0]!, u: 0 };
}

/** Оценка повтора k в подходе i: ошибочный — ниже, чистые — 91–98. */
const scoreOf = (i: number, k: number) => (k === BAD_REP ? 64 : 91 + ((k * 5 + i * 3) % 8));

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
  { title: 'Челлендж 60 секунд', meta: 'Максимум чистых приседаний' },
  { title: 'Дуэль отжиманий', meta: 'Соревнуйся с соперником' },
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
  const show = useShowcase(clock);
  const cur = SHOWCASE[show.i]!;
  // Атлет видит время своего подхода; после пятого повтора — стоит (поза конца цикла = стойка).
  const [athleteClock] = useState(() => () => {
    const { s, u } = locate(clock());
    return Math.min(u, SET * s.rep - 1);
  });
  const [ready, setReady] = useState(false);
  const bad = show.live === 'bad';
  const error = findFormError(cur.ex, cur.code)?.message ?? '';
  const clean = show.scores.filter((_, k) => k !== BAD_REP).length;

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

        <figure
          className={`atlas rise ${ready ? 'is-ready' : ''} ${show.leaving ? 'is-leaving' : ''}`}
          style={order(2)}
          aria-hidden="true"
        >
          <div className="atlas__boot">
            <span className="atlas__spinner" />
            <span>Загружаем 3D-модель…</span>
          </div>
          <Ghost
            exercise={cur.ex}
            yaw={cur.yaw}
            clock={athleteClock}
            highlight={bad ? cur.hl : undefined}
            className="atlas__ghost"
            anatomyOnly
            onReady={() => setReady(true)}
          />
          <div className="atlas__calls" key={cur.ex}>
            {cur.calls.map((c, k) => (
              <Callout
                key={c.name}
                call={c}
                i={k}
                value={c.value.replace('%', `${Math.round(40 + 55 * show.depth)}%`)}
                bad={bad && !!c.err}
              />
            ))}
          </div>
        </figure>

        <aside className="hud rise" style={order(3)} aria-label="Пример анализа повтора">
          <header className="hud__head" key={cur.ex}>
            <b>{EXERCISE_META[cur.ex].short}</b>
            <span>
              {show.i + 1} из {SHOWCASE.length}
            </span>
          </header>
          <div className={`hud__ring ${show.lastBad ? 'is-bad' : 'is-good'}`}>
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" className="hud__track" />
              <circle
                cx="50"
                cy="50"
                r="44"
                pathLength="100"
                className="hud__fill"
                style={{ strokeDasharray: `${show.score} 100` }}
              />
            </svg>
            <b>{show.score ? show.score : '—'}</b>
            <small>{show.done ? 'средняя' : 'оценка'}</small>
          </div>
          <div className="hud__row">
            <span>Повторы</span>
            <b>
              {show.n} <small>/ {SET}</small>
            </b>
          </div>
          <ol className="hud__pips" aria-hidden="true">
            {Array.from({ length: SET }, (_, k) => (
              <li
                key={k}
                className={
                  k < show.n
                    ? k === BAD_REP
                      ? 'is-bad'
                      : 'is-good'
                    : k === show.n && !show.done
                      ? 'is-now'
                      : ''
                }
              />
            ))}
          </ol>
          <div
            className={`hud__state is-${show.done ? 'done' : bad ? 'bad' : 'good'}`}
            key={show.live + show.n}
          >
            <Icon name={bad ? 'alert' : 'check'} size={18} />
            {show.done
              ? `Подход выполнен · ${clean} из ${SET} чисто`
              : bad
                ? error
                : show.n === 0
                  ? 'Скелет найден — начинаем'
                  : show.lastBad
                    ? 'Исправил — так держать'
                    : 'Чистое повторение'}
          </div>
        </aside>
      </section>

      <section id="how" className="lsec">
        <header className="lsec__head" data-reveal>
          <span className="lsec__eyebrow">Как это работает</span>
          <h2>Четыре шага — и ты тренируешься с тренером</h2>
        </header>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.n} className="step" data-reveal style={order(i)}>
              <span className="step__n">{i + 1}</span>
              <StepFigure i={i} />
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="exercises" className="lsec">
        <header className="lsec__head" data-reveal>
          <span className="lsec__eyebrow">Упражнения</span>
          <h2>{EXERCISES.length} упражнений в 4 категориях</h2>
        </header>
        <div className="cats">
          {CATEGORIES.map((c, i) => (
            <article key={c.id} className="panel cat" data-reveal style={order(i)}>
              <header>
                <span className="cat__icon">
                  <Icon name={c.icon} size={20} />
                </span>
                <h3>{c.title}</h3>
                <span className="cat__count">{c.items.length}</span>
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
            <span className="lsec__eyebrow">Режим «ошибка»</span>
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
                  <span className="err__icon">
                    <Icon name="alert" size={18} />
                  </span>
                  <div>
                    <b>{def.message}</b>
                    <small>{EXERCISE_META[s.exercise].title}</small>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <header className="lsec__head" data-reveal>
            <span className="lsec__eyebrow">Соревнование</span>
            <h2>Режимы и рейтинг</h2>
          </header>
          <div className="modes">
            <ul className="modes__list">
              {MODES.map((m, i) => (
                <li key={m.title} className="panel" data-reveal style={order(i)}>
                  <b>{m.title}</b>
                  <small>{m.meta}</small>
                </li>
              ))}
            </ul>
            <div className="panel top" data-reveal>
              <div className="top__head">
                <b>Рейтинг</b>
                <small>Сегодня · неделя · всё время</small>
              </div>
              <ol>
                {SAMPLE_TOP.map((r, i) => (
                  <li key={r.name} className={r.me ? 'is-me' : ''}>
                    <span>{i + 1}</span>
                    <span className="top__who">
                      <i>{r.name.slice(0, 1)}</i>
                      {r.name}
                    </span>
                    <b>{r.score.toLocaleString('ru-RU')}</b>
                  </li>
                ))}
              </ol>
              <small>В зачёт — только чистые повторения</small>
            </div>
          </div>
        </div>
      </section>

      <section className="final" data-reveal>
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

interface ShowState {
  i: number;
  /** Засчитано повторов в подходе. */
  n: number;
  /** Идущий сейчас повтор: чистый или с ошибкой. */
  live: 'good' | 'bad';
  lastBad: boolean;
  done: boolean;
  leaving: boolean;
  depth: number;
  /** Оценка последнего повтора, после подхода — средняя; 0 — ещё нет. */
  score: number;
  scores: number[];
}

/** Состояние витрины по тем же часам, что и атлет: повтор атлета = повтор на счётчике. */
function useShowcase(clock: () => number): ShowState {
  // При reduced motion — статичный кадр: середина подхода с ошибкой (самое информативное).
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [state, setState] = useState<ShowState>(() =>
    reduced ? { ...at(SHOWCASE[0]!.rep * 3.5), depth: 0.8 } : at(0),
  );
  useEffect(() => {
    if (reduced) return;
    const tick = () =>
      setState((s) => {
        const next = at(clock());
        const same =
          s.i === next.i &&
          s.n === next.n &&
          s.live === next.live &&
          s.done === next.done &&
          s.leaving === next.leaving &&
          Math.abs(s.depth - next.depth) < 0.04;
        return same ? s : next;
      });
    const id = setInterval(tick, 80);
    return () => clearInterval(id);
  }, [clock, reduced]);
  return state;
}

function at(t: number): ShowState {
  const { i, s, u } = locate(t);
  const c = Math.floor(u / s.rep);
  const n = Math.min(SET, c);
  const done = c >= SET;
  const scores = Array.from({ length: n }, (_, k) => scoreOf(i, k));
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  return {
    i,
    n,
    live: !done && c === BAD_REP ? 'bad' : 'good',
    lastBad: !done && n - 1 === BAD_REP,
    done,
    leaving: u > segLen(s) - FADE_MS,
    depth: done ? 0 : Math.sin(Math.PI * ((u % s.rep) / s.rep)),
    score: done ? avg : (scores[n - 1] ?? 0),
    scores,
  };
}

function Callout({ call, i, value, bad }: { call: Call; i: number; value: string; bad: boolean }) {
  const cls = ['atlas__call', `atlas__call--${call.side}`, call.dim ? 'is-dim' : '', bad ? 'is-bad' : ''];
  return (
    <span className={cls.join(' ')} style={{ top: `${call.top}%`, animationDelay: `${120 + i * 70}ms` }}>
      <i />
      <b>{call.ru}</b>
      <small>{value}</small>
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
