// U-10: итоги. Повторы, % чистой техники, топ-3 ошибки с советом, оценка каждого повтора, очки.
// Результат сразу учитывается в прогрессе; в рекорды — по кнопке (ник выбирается жестом).

import { useEffect, useRef } from 'react';
import { say } from '../audio/voice';
import { sfx } from '../audio/sfx';
import { Confetti } from '../components/Confetti';
import { DwellButton } from '../components/dwell';
import { Icon } from '../components/Icon';
import { QualityChart } from '../components/QualityChart';
import { EXERCISE_META, type Plan } from '../lib/exercises';
import { formatDuration, totalsOf, type SetResult } from '../lib/results';
import { addToTotals, qualifies, type RecordEntry } from '../store/progress';
import { order } from '../lib/motion';
import { useCountUp } from '../lib/useCountUp';
import { scoreColor } from '../theme';
import './Summary.css';

export type PendingRecord = Omit<RecordEntry, 'id' | 'date' | 'name'>;

/** Результаты, уже учтённые в прогрессе: StrictMode и повторный монтаж не должны считать их дважды. */
const counted = new WeakSet<SetResult[]>();

export function Summary({
  plan,
  results,
  onAgain,
  onMenu,
  onSave,
  demo = false,
  onCamera,
}: {
  plan: Plan;
  results: SetResult[];
  onAgain: () => void;
  onMenu: () => void;
  onSave: (r: PendingRecord) => void;
  /** Демо без камеры: результат не сохраняется, вместо «В рекорды» — «Включить камеру». */
  demo?: boolean;
  onCamera?: () => void;
}) {
  const t = totalsOf(results);
  const isRecord = !demo && qualifies(t.points);
  const spoke = useRef(false);

  useEffect(() => {
    if (!demo && !counted.has(results)) {
      counted.add(results);
      addToTotals(t.reps, t.cleanReps, t.durationSec);
    }
    if (spoke.current) return;
    spoke.current = true;
    sfx.fanfare();
    const advice = t.topErrors[0] ? ` Главное на следующий раз: ${t.topErrors[0].message}.` : '';
    say(
      t.reps
        ? `Готово! ${t.reps} повторений, чистых ${t.cleanPct} процентов.${advice}`
        : 'Подход завершён. В следующий раз получится!',
      'info',
    );
  }, [demo, results, t.reps, t.cleanReps, t.durationSec, t.cleanPct, t.topErrors]);

  const record: PendingRecord = {
    kind: plan.kind,
    label: plan.label,
    points: t.points,
    reps: t.reps,
    cleanReps: t.cleanReps,
    avgScore: t.avgScore,
    durationSec: t.durationSec,
  };

  return (
    <main className="screen summary">
      {isRecord && t.reps > 0 && <Confetti />}
      <header className="summary__head">
        <span className="eyebrow">{plan.label}</span>
        <h1 className="summary__title rise" style={order(0)}>
          {t.reps ? 'Тренировка завершена' : 'Подход завершён'}
        </h1>
        {isRecord && t.reps > 0 && (
          <span className="eyebrow eyebrow--good summary__record">
            <Icon name="trophy" size={18} /> Результат для таблицы рекордов
          </span>
        )}
      </header>

      <section className="summary__stats" aria-label="Итоги">
        <Stat i={1} big label="Очки" value={t.points} />
        <Stat i={2} label="Повторений" value={t.reps} />
        <Stat
          i={3}
          label="Чистая техника"
          value={t.cleanPct}
          format={(n) => `${n}%`}
          color={scoreColor(t.cleanPct)}
        />
        <Stat i={4} label="Средняя оценка" value={t.avgScore} color={scoreColor(t.avgScore)} />
        <Stat i={5} label="Время" value={t.durationSec} format={formatDuration} />
      </section>

      <section className="summary__body">
        <div className="card summary__card rise" style={order(6)}>
          <h3>Каждое повторение</h3>
          <QualityChart scores={t.perRep.map((r) => r.score)} />
          {results.length > 1 && (
            <ul className="summary__sets">
              {results.map((r) => (
                <li key={r.exercise}>
                  <b>{EXERCISE_META[r.exercise].title}</b>
                  <span>
                    {r.stats.reps}/{r.target} · чистых {r.stats.cleanReps} · оценка {r.stats.avgScore}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card summary__card rise" style={order(7)}>
          <h3>Над чем поработать</h3>
          {t.topErrors.length === 0 ? (
            <p className="summary__clean">
              <Icon name="check" size={28} /> Ошибок техники не было — отличная работа!
            </p>
          ) : (
            <ol className="summary__errors">
              {t.topErrors.map((e, i) => (
                <li key={`${e.exercise}:${e.code}`} className="rise" style={order(8 + i)}>
                  <span className="summary__err-count">×{e.count}</span>
                  <div>
                    <b>{e.message}</b>
                    <small className="muted">{EXERCISE_META[e.exercise].title}</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <footer className="summary__actions">
        {demo && onCamera && (
          <DwellButton variant="primary" size="lg" onSelect={onCamera}>
            <Icon name="camera" size={30} /> Попробовать с камерой
          </DwellButton>
        )}
        {isRecord && t.reps > 0 && (
          <DwellButton variant="primary" size="lg" onSelect={() => onSave(record)}>
            <Icon name="trophy" size={30} /> В рекорды
          </DwellButton>
        )}
        <DwellButton size="lg" onSelect={onAgain}>
          <Icon name="retry" size={30} /> Ещё раз
        </DwellButton>
        <DwellButton size="lg" variant="ghost" onSelect={onMenu}>
          <Icon name="home" size={30} /> Меню
        </DwellButton>
      </footer>
    </main>
  );
}

function Stat({
  i,
  label,
  value,
  big,
  color,
  format = String,
}: {
  i: number;
  label: string;
  value: number;
  big?: boolean;
  color?: string;
  format?: (n: number) => string;
}) {
  const n = useCountUp(value, 1000, 150 + i * 90);
  return (
    <div className={`stat rise ${big ? 'stat--big' : ''}`} style={order(i)}>
      <span className="stat__value" style={color ? { color } : undefined}>
        {format(n)}
      </span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
