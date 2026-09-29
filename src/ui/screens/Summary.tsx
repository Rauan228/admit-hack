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
}: {
  plan: Plan;
  results: SetResult[];
  onAgain: () => void;
  onMenu: () => void;
  onSave: (r: PendingRecord) => void;
}) {
  const t = totalsOf(results);
  const isRecord = qualifies(t.points);
  const spoke = useRef(false);

  useEffect(() => {
    if (!counted.has(results)) {
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
  }, [results, t.reps, t.cleanReps, t.durationSec, t.cleanPct, t.topErrors]);

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
        <span className="badge badge--primary">{plan.label}</span>
        <h1 className="summary__title">{t.reps ? 'Тренировка завершена' : 'Подход завершён'}</h1>
        {isRecord && t.reps > 0 && (
          <span className="badge badge--good summary__record">
            <Icon name="trophy" size={18} /> Результат для таблицы рекордов
          </span>
        )}
      </header>

      <section className="summary__stats" aria-label="Итоги">
        <Stat big label="Очки" value={t.points} />
        <Stat label="Повторений" value={t.reps} />
        <Stat label="Чистая техника" value={`${t.cleanPct}%`} color={scoreColor(t.cleanPct)} />
        <Stat label="Средняя оценка" value={t.avgScore} color={scoreColor(t.avgScore)} />
        <Stat label="Время" value={formatDuration(t.durationSec)} />
      </section>

      <section className="summary__body">
        <div className="card summary__card">
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

        <div className="card summary__card">
          <h3>Над чем поработать</h3>
          {t.topErrors.length === 0 ? (
            <p className="summary__clean">
              <Icon name="check" size={28} /> Ошибок техники не было — отличная работа!
            </p>
          ) : (
            <ol className="summary__errors">
              {t.topErrors.map((e) => (
                <li key={`${e.exercise}:${e.code}`}>
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
  label,
  value,
  big,
  color,
}: {
  label: string;
  value: string | number;
  big?: boolean;
  color?: string;
}) {
  return (
    <div className={`stat ${big ? 'stat--big' : ''}`}>
      <span className="stat__value" style={color ? { color } : undefined}>
        {value}
      </span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
