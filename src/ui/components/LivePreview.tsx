// «Живое превью» для лендинга: атлет-эталон и HUD приложения поверх — счётчик тикает синхронно
// с движением, на каждом повторе всплывает оценка, через раз — подсказка об ошибке с подсветкой суставов.
// Показывает продукт в действии ещё до того, как человек включил камеру.

import { useCallback, useEffect, useState } from 'react';
import { FORM_ERRORS } from '../../engine/hints';
import type { ExerciseId } from '../../engine/types';
import { durationOf } from '../lib/athlete';
import { EXERCISE_META } from '../lib/exercises';
import { scoreColor } from '../theme';
import { Ghost } from './Ghost';
import { Icon } from './Icon';
import './LivePreview.css';

const ORDER: ExerciseId[] = ['squat', 'jumping_jack', 'lunge', 'arm_raise'];
const REPS_PER_EXERCISE = 3;

interface Tick {
  exercise: ExerciseId;
  rep: number;
  /** Время внутри текущего упражнения, мс. */
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
  const showHint = phase > 0.35 && phase < 0.95;
  const done = rep; // завершённых повторов
  // Оценка последнего завершённого повтора: второй (индекс 1) — с ошибкой.
  const lastScore = done > 0 ? (done - 1 === 1 ? 72 : 96 - done) : null;
  const highlight = flawed && showHint && err ? new Set(err.joints) : undefined;

  return (
    <div className="preview">
      <div className="preview__frame">
        <div className="preview__scan" aria-hidden="true" />
        <Ghost
          key={exercise}
          exercise={exercise}
          className="preview__athlete"
          yaw={0.3}
          sway
          clock={clock}
          highlight={highlight}
        />

        <header className="preview__top">
          <div>
            <span className="preview__label">Сейчас</span>
            <b key={exercise} className="preview__title">
              {meta.title}
            </b>
          </div>
          <div className="preview__count" aria-hidden="true">
            <svg viewBox="0 0 60 60">
              <circle cx="30" cy="30" r="26" className="preview__ring-track" />
              <circle
                cx="30"
                cy="30"
                r="26"
                pathLength="1"
                className="preview__ring"
                style={{ strokeDashoffset: 1 - done / REPS_PER_EXERCISE }}
              />
            </svg>
            <span key={`${exercise}-${done}`}>{done}</span>
          </div>
        </header>

        {lastScore !== null && (
          <span
            key={`f-${exercise}-${done}`}
            className="preview__float"
            style={{ color: scoreColor(lastScore) }}
          >
            +{lastScore}
          </span>
        )}

        <div className="preview__hint-slot" aria-hidden="true">
          {showHint && err && (
            <div key={`${exercise}-${rep}`} className={`preview__hint ${flawed ? 'is-bad' : 'is-good'}`}>
              <Icon name={flawed ? 'alert' : 'check'} size={22} />
              {flawed ? err.message : 'Отлично! Чистое повторение'}
            </div>
          )}
        </div>
      </div>
      <ol className="preview__dots" aria-hidden="true">
        {ORDER.map((e) => (
          <li key={e} className={e === exercise ? 'is-on' : ''} />
        ))}
      </ol>
    </div>
  );
}
