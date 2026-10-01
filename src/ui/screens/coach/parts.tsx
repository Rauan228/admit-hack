// Общие куски раздела «ИИ-тренер»: шаги анкеты, мини-график, кольцо прогресса, превью упражнения в рамке.

import type { ExerciseId } from '../../../engine/types';
import { ExerciseThumb } from '../../components/ExerciseThumb';
import { Icon } from '../../components/Icon';
import { FLOW } from './draft';

/** Шаги сверху: пройденные — с галочкой и кликабельны (назад), текущий — оранжевый. */
export function FlowSteps({ at, onJump }: { at: number; onJump?: (i: number) => void }) {
  return (
    <ol className="ch-flow" aria-label="Шаги">
      {FLOW.map((s, i) => (
        <li key={s} className={i === at ? 'is-active' : i < at ? 'is-done' : ''}>
          <button type="button" disabled={!onJump || i >= at || i > 2} onClick={() => onJump?.(i)}>
            <span className="ch-flow__dot">{i < at ? <Icon name="check" size={14} /> : i + 1}</span>
            <span className="ch-flow__name">{s}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Превью упражнения в рамке (атлет в узнаваемой позе). */
export function Thumb({ exercise, size = 'md' }: { exercise: ExerciseId; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`ch-thumb ch-thumb--${size}`} aria-hidden="true">
      <ExerciseThumb exercise={exercise} />
    </span>
  );
}

/** Линия с заливкой по точкам (значения ≥ 0). */
export function Spark({ values }: { values: number[] }) {
  const W = 300;
  const H = 110;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [
    values.length === 1 ? W / 2 : (i / (values.length - 1)) * (W - 16) + 8,
    H - 12 - (v / max) * (H - 30),
  ]);
  const line = pts.map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1]!;
  return (
    <svg className="ch-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="ch-spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f97316" stopOpacity="0.35" />
          <stop offset="1" stopColor="#f97316" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${pts[0]![0]},${H} ${line} ${last[0]},${H}`} fill="url(#ch-spark-fill)" />
      <polyline points={line} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 5 : 3} fill="#f97316" />
      ))}
    </svg>
  );
}

/** Кольцо прогресса с процентом внутри. */
export function Ring({ pct, sub }: { pct: number; sub: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="ch-ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} className="ch-ring__track" />
        <circle
          cx="60"
          cy="60"
          r={r}
          className="ch-ring__bar"
          strokeDasharray={`${(c * Math.min(100, pct)) / 100} ${c}`}
        />
      </svg>
      <div className="ch-ring__text">
        <b>{pct}%</b>
        <small>{sub}</small>
      </div>
    </div>
  );
}
