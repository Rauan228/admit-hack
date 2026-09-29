// U-10: итоги. Повторы, % чистой техники, топ-3 ошибки с советом, оценка каждого повтора, очки.
// Рейтинг режима считается сразу; сохранить в общий рейтинг — по кнопке (гостя попросим войти).

import { useEffect, useRef, useState } from 'react';
import type { Board } from '../../shared/rating';
import { say } from '../audio/voice';
import { sfx } from '../audio/sfx';
import { Confetti } from '../components/Confetti';
import { DwellButton } from '../components/dwell';
import { Icon } from '../components/Icon';
import { QualityChart } from '../components/QualityChart';
import { EXERCISE_META, type Plan } from '../lib/exercises';
import { formatDuration, totalsOf, type SetResult } from '../lib/results';
import { boardOf, boardTitle, boardUnit, ratingOf, resultInput } from '../lib/rating';
import { ApiError, saveResult, useAuth, type SaveResponse } from '../store/api';
import { addToTotals } from '../store/progress';
import { order } from '../lib/motion';
import { useCountUp } from '../lib/useCountUp';
import { scoreColor } from '../theme';
import './Summary.css';

/** Результаты, уже учтённые в прогрессе: StrictMode и повторный монтаж не должны считать их дважды. */
const counted = new WeakSet<SetResult[]>();

export function Summary({
  plan,
  results,
  onAgain,
  onMenu,
  demo = false,
  onCamera,
  autoSave = false,
  onNeedAuth,
  onBoard,
  onProgress,
}: {
  plan: Plan;
  results: SetResult[];
  onAgain: () => void;
  onMenu: () => void;
  /** Демо без камеры: результат не сохраняется, вместо «В рекорды» — «Включить камеру». */
  demo?: boolean;
  onCamera?: () => void;
  /** Вернулись с экрана входа — сохранить сразу. */
  autoSave?: boolean;
  /** Гость нажал «Сохранить»: подпись того, что сохранится. */
  onNeedAuth: (pending: string) => void;
  onBoard: (board: Board) => void;
  onProgress: () => void;
}) {
  const t = totalsOf(results);
  const { user } = useAuth();
  const board = boardOf(plan);
  const rating = ratingOf(plan, results);
  const unit = boardUnit(board);
  const canSave = !demo && t.reps > 0;
  const [save, setSave] = useState<
    { s: 'idle' } | { s: 'saving' } | { s: 'saved'; r: SaveResponse } | { s: 'error'; msg: string }
  >({ s: 'idle' });
  const spoke = useRef(false);
  const autoSaved = useRef(false);

  const doSave = async () => {
    if (!canSave || save.s === 'saving' || save.s === 'saved') return;
    if (!user) {
      onNeedAuth(`${boardTitle(board)} · ${rating} ${unit}`);
      return;
    }
    setSave({ s: 'saving' });
    try {
      const r = await saveResult(resultInput(plan, results));
      setSave({ s: 'saved', r });
      if (r.personalBest) sfx.fanfare();
    } catch (e) {
      setSave({ s: 'error', msg: e instanceof ApiError ? e.message : 'Не получилось сохранить' });
    }
  };
  const saveRef = useRef(doSave);
  useEffect(() => {
    saveRef.current = doSave;
  });
  useEffect(() => {
    if (autoSave && user && !autoSaved.current) {
      autoSaved.current = true;
      void saveRef.current();
    }
  }, [autoSave, user]);
  const best = save.s === 'saved' && save.r.personalBest;

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

  return (
    <main className="screen summary">
      {best && <Confetti />}
      <header className="summary__head">
        <span className="eyebrow">{plan.label}</span>
        <h1 className="summary__title rise" style={order(0)}>
          {t.reps ? 'Тренировка завершена' : 'Подход завершён'}
        </h1>
        {demo && <span className="eyebrow eyebrow--muted">Демо — в рейтинг не сохраняется</span>}
      </header>

      <section className="summary__stats" aria-label="Итоги">
        <Stat i={1} big label={`Рейтинг · ${unit}`} value={rating} />
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

      {canSave && (
        <SavePanel
          state={save}
          signedIn={!!user}
          board={board}
          unit={unit}
          onSave={doSave}
          onBoard={() => onBoard(board)}
          onProgress={onProgress}
        />
      )}

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

function SavePanel({
  state,
  signedIn,
  board,
  unit,
  onSave,
  onBoard,
  onProgress,
}: {
  state: { s: 'idle' } | { s: 'saving' } | { s: 'saved'; r: SaveResponse } | { s: 'error'; msg: string };
  signedIn: boolean;
  board: Board;
  unit: string;
  onSave: () => void;
  onBoard: () => void;
  onProgress: () => void;
}) {
  if (state.s === 'saved') {
    const { r } = state;
    const delta = r.prevLast === null ? null : r.result.rating - r.prevLast;
    return (
      <section className="card save save--done rise" aria-live="polite">
        <div className="save__rank">
          <span className="save__place">#{r.rank ?? '—'}</span>
          <span className="muted">
            из {r.players} в рейтинге «{boardTitle(board)}»
          </span>
        </div>
        <div className="save__facts">
          {r.personalBest ? (
            <b className="save__pb">
              <Icon name="trophy" size={22} />{' '}
              {r.prevBest === null ? 'Первый результат — это твой рекорд' : 'Новый личный рекорд!'}
            </b>
          ) : (
            <span>
              Личный рекорд: <b>{r.prevBest}</b> {unit}
            </span>
          )}
          {delta !== null && delta !== 0 && (
            <span className={delta > 0 ? 'save__up' : delta < 0 ? 'save__down' : ''}>
              {delta > 0 ? `+${delta}` : delta} к прошлому разу
            </span>
          )}
        </div>
        <div className="save__actions">
          <DwellButton size="sm" variant="primary" onSelect={onBoard}>
            <Icon name="trophy" size={22} /> Рейтинг
          </DwellButton>
          <DwellButton size="sm" onSelect={onProgress}>
            <Icon name="zap" size={22} /> Мой прогресс
          </DwellButton>
        </div>
      </section>
    );
  }
  return (
    <section className="card save rise">
      <div className="save__text">
        <b>{signedIn ? 'Сохрани результат в общий рейтинг' : 'Хочешь сохранить результат?'}</b>
        <span className="muted">
          {state.s === 'error'
            ? state.msg
            : signedIn
              ? 'Увидишь своё место и прирост к прошлому разу.'
              : 'Войди или зарегистрируйся — займёт 30 секунд. Появятся рейтинг и личные рекорды.'}
        </span>
      </div>
      <DwellButton variant="primary" size="lg" onSelect={onSave} disabled={state.s === 'saving'}>
        <Icon name="trophy" size={30} />{' '}
        {state.s === 'saving' ? 'Сохраняем…' : state.s === 'error' ? 'Ещё раз' : 'Сохранить'}
      </DwellButton>
    </section>
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
