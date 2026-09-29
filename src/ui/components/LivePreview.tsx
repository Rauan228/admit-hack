// «Живой экран» для лендинга: атлет-эталон и HUD приложения — счётчик тикает синхронно с движением,
// на каждом повторе всплывает оценка, через раз — подсказка об ошибке с подсветкой суставов,
// справа — чек-лист техники, где загорается пункт текущей ошибки. Продукт в действии до включения камеры.

import { useCallback, useEffect, useState } from 'react';
import { FORM_ERRORS } from '../../engine/hints';
import type { ExerciseId } from '../../engine/types';
import { durationOf } from '../lib/athlete';
import { EXERCISE_META } from '../lib/exercises';
import { Ghost } from './Ghost';
import { Icon } from './Icon';
import './LivePreview.css';

const ORDER: ExerciseId[] = ['squat', 'jumping_jack', 'lunge', 'arm_raise'];
const REPS_PER_EXERCISE = 3;
const TARGET = 10;

/** Короткие пункты чек-листа: код ошибки → что держать. */
const CHECK: Partial<Record<ExerciseId, [string, string][]>> = {
  squat: [
    ['shallow_depth', 'Глубже'],
    ['torso_lean', 'Спина прямо'],
    ['knees_in', 'Колени в стороны'],
  ],
  jumping_jack: [
    ['arms_low', 'Руки выше'],
    ['feet_narrow', 'Ноги шире'],
    ['not_synced', 'Синхронно'],
  ],
  lunge: [
    ['back_knee_high', 'Колено к полу'],
    ['knee_past_toe', 'Колено над стопой'],
    ['torso_lean', 'Корпус ровно'],
  ],
  arm_raise: [
    ['elbows_bent', 'Локти прямые'],
    ['one_arm_low', 'Обе руки вместе'],
  ],
};

interface Tick {
  exercise: ExerciseId;
  rep: number;
  t: number;
}

function tickAt(ms: number): Tick {
  let left = ms;
  for (let k = 0; ; k += 1) {
    const exercise = ORDER[k % ORDER.length]!;
    const block = durationOf(exercise) * REPS_PER_EXERCISE;
    if (left < block) return { exercise, rep: Math.floor(left / durationOf(exercise)), t: left };
    left -= block;
  }
}

export function LivePreview() {
  const [t0] = useState(() => performance.now());
  const clock = useCallback(() => tickAt(performance.now() - t0).t, [t0]);
  const [tick, setTick] = useState<Tick>(() => tickAt(0));

  useEffect(() => {
    const id = setInterval(() => setTick(tickAt(performance.now() - t0)), 120);
    return () => clearInterval(id);
  }, [t0]);

  const { exercise, rep } = tick;
  const meta = EXERCISE_META[exercise];
  const dur = durationOf(exercise);
  const phase = (tick.t % dur) / dur;
  // Второй повтор каждого упражнения — с ошибкой, остальные чистые.
  const flawed = rep === 1;
  const err = FORM_ERRORS[exercise][0];
  const showHint = phase > 0.3 && phase < 0.92;
  const done = rep;
  const lastScore = done > 0 ? (done - 1 === 1 ? 72 : 96 - done) : null;
  const highlight = flawed && showHint && err ? new Set(err.joints) : undefined;
  const activeCode = flawed && showHint ? err?.code : null;

  return (
    <div className="screenhud">
      <div className="screenhud__frame">
        <div className="screenhud__main">
          <Ghost
            key={exercise}
            exercise={exercise}
            className="screenhud__athlete"
            sway
            clock={clock}
            highlight={highlight}
          />
          <span key={`t-${exercise}`} className="screenhud__title">
            {meta.title}
          </span>
          <div className="screenhud__hint-slot" aria-hidden="true">
            {showHint && err && (
              <div key={`${exercise}-${rep}`} className={`screenhud__hint ${flawed ? 'is-bad' : 'is-good'}`}>
                <span className="screenhud__hint-icon">
                  <Icon name={flawed ? 'alert' : 'check'} size={18} />
                </span>
                {flawed ? err.message : 'Отлично! Чистое повторение'}
              </div>
            )}
          </div>
          {highlight && <span className="screenhud__arrow" aria-hidden="true" />}
        </div>

        <aside className="screenhud__side" aria-hidden="true">
          <div className="screenhud__count">
            <svg viewBox="0 0 60 60">
              <circle cx="30" cy="30" r="26" className="screenhud__ring-track" />
              <circle
                cx="30"
                cy="30"
                r="26"
                pathLength="1"
                className="screenhud__ring"
                style={{ strokeDashoffset: 1 - done / TARGET }}
              />
            </svg>
            <span key={`${exercise}-${done}`} className="screenhud__num">
              {done}
            </span>
            <small>
              {done}/{TARGET}
            </small>
          </div>
          <div className="screenhud__score">
            <b key={`s-${exercise}-${done}`}>{lastScore !== null ? `+${lastScore}` : '—'}</b>
            <span>баллы</span>
          </div>
          <ul className="screenhud__checks">
            <li className={!activeCode && done > 0 ? 'is-ok' : ''}>
              <Icon name="check" size={16} /> Правильно
            </li>
            {(CHECK[exercise] ?? []).map(([code, label]) => (
              <li key={code} className={code === activeCode ? 'is-bad' : ''}>
                <Icon name={code === activeCode ? 'alert' : 'user'} size={16} /> {label}
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <p className="screenhud__voice">
        <span className="screenhud__wave" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
        </span>
        Голосовой тренер подсказывает в реальном времени
      </p>
    </div>
  );
}
