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
import './Summary.css';

/** Результаты, уже учтённые в прогрессе: StrictMode и повторный монтаж не должны считать их дважды. */
const counted = new WeakSet<SetResult[]>();

type SaveState =
  { s: 'idle' } | { s: 'saving' } | { s: 'saved'; r: SaveResponse } | { s: 'error'; msg: string };

/** «1 раз», «3 раза», «5 раз». */
function times(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  const w = d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'раза' : 'раз';
  return `${n} ${w}`;
}

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
  const canSave = !demo && plan.kind !== 'custom' && t.reps > 0;
  const [save, setSave] = useState<SaveState>({ s: 'idle' });
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

  const allSec = results.every((r) => EXERCISE_META[r.exercise].unit === 'sec');

  return (
    <main className="page summary">
      {best && <Confetti />}
      <div className="page__inner">
        <header className="page__head summary__head rise" style={order(0)}>
          <span className="tag">{plan.label}</span>
          <h1 className="page__title">{t.reps ? 'Тренировка завершена' : 'Подход завершён'}</h1>
          {demo && <span className="eyebrow eyebrow--muted">Демо — в рейтинг не сохраняется</span>}
        </header>

        <section className="summary__hero rise" style={order(1)} aria-label="Итоги">
          <CleanRing pct={t.cleanPct} />
          <div className="summary__stats">
            <Stat i={2} label={allSec ? 'Секунд' : 'Повторений'} value={t.reps} />
            <Stat i={3} label="Средняя оценка" value={t.avgScore} />
            <Stat i={4} label="Время" value={t.durationSec} format={formatDuration} />
          </div>
        </section>

        {save.s === 'saved' && save.r.personalBest && <RecordBanner r={save.r} unit={unit} />}

        <div className="summary__grid">
          <div className="summary__col">
            <section className="summary__panel summary__panel--chart rise" style={order(5)}>
              <QualityChart scores={t.perRep.map((r) => r.score)} />
            </section>

            {results.length > 0 && (
              <section className="summary__panel summary__panel--sets rise" style={order(6)}>
                <h2 className="summary__h">Результаты по упражнениям</h2>
                <ul className="summary__sets">
                  {results.map((r) => {
                    const sec = EXERCISE_META[r.exercise].unit === 'sec';
                    const pct = r.stats.reps ? Math.round((r.stats.cleanReps / r.stats.reps) * 100) : 0;
                    return (
                      <li key={r.exercise}>
                        <span className="summary__set-icon" aria-hidden="true">
                          <Icon name={sec ? 'timer' : 'run'} size={18} />
                        </span>
                        <b className="summary__set-name">{EXERCISE_META[r.exercise].title}</b>
                        <span className="summary__set-reps">
                          {sec ? `${r.stats.reps}/${r.target} с` : `${r.stats.reps}/${r.target}`}
                        </span>
                        <span className="summary__set-pct">
                          {pct}%<small> чистых</small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>

          <div className="summary__col">
            <section className="summary__panel summary__panel--errors rise" style={order(7)}>
              <h2 className="summary__h">Над чем поработать</h2>
              {t.topErrors.length === 0 ? (
                <p className="summary__clean">
                  <span className="summary__clean-icon" aria-hidden="true">
                    <Icon name="check" size={18} />
                  </span>
                  {t.reps ? 'Ошибок техники не было — отличная работа!' : 'Повторений не было — ошибок тоже.'}
                </p>
              ) : (
                <ol className="summary__errors">
                  {t.topErrors.map((e, i) => (
                    <li key={`${e.exercise}:${e.code}`} className="rise" style={order(8 + i)}>
                      <span className="summary__err-icon" aria-hidden="true">
                        <Icon name="alert" size={18} />
                      </span>
                      <div className="summary__err-text">
                        <b>{e.message}</b>
                        <small>{EXERCISE_META[e.exercise].title}</small>
                      </div>
                      <span className="summary__err-count">{times(e.count)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {canSave && (
              <SavePanel
                state={save}
                signedIn={!!user}
                board={board}
                rating={rating}
                unit={unit}
                onSave={doSave}
                onBoard={() => onBoard(board)}
                onProgress={onProgress}
              />
            )}
            {demo && (
              <section className="summary__panel summary-save summary-save--demo rise" style={order(9)}>
                <span className="tag">демо без камеры</span>
                <p className="summary-save__text">
                  Результат демо не попадает в рейтинг. Включи камеру — и FORMA посчитает твои настоящие
                  повторения.
                </p>
              </section>
            )}
          </div>
        </div>

        <footer className="summary__actions rise" style={order(10)}>
          {demo && onCamera && (
            <DwellButton variant="primary" size="lg" onSelect={onCamera}>
              <Icon name="camera" size={24} /> Попробовать с камерой
            </DwellButton>
          )}
          <DwellButton size="lg" variant={demo && onCamera ? 'default' : 'primary'} onSelect={onAgain}>
            <Icon name="retry" size={24} /> Ещё раз
          </DwellButton>
          <DwellButton size="lg" onSelect={onMenu}>
            <Icon name="home" size={24} /> В меню
          </DwellButton>
        </footer>
      </div>
    </main>
  );
}

/** Зелёная плашка «Новый личный рекорд» — только когда сервер подтвердил рекорд. */
function RecordBanner({ r, unit }: { r: SaveResponse; unit: string }) {
  const delta = r.prevLast === null ? null : r.result.rating - r.prevLast;
  return (
    <section className="summary__record rise" aria-live="polite">
      <span className="summary__record-icon" aria-hidden="true">
        <Icon name="trophy" size={22} />
      </span>
      <div>
        <b>{r.prevBest === null ? 'Первый результат — это твой рекорд' : 'Новый личный рекорд!'}</b>
        <span>
          {delta !== null && delta > 0
            ? `+${delta} к прошлому разу`
            : `${r.result.rating} ${unit} — лучший результат`}
        </span>
      </div>
    </section>
  );
}

function SavePanel({
  state,
  signedIn,
  board,
  rating,
  unit,
  onSave,
  onBoard,
  onProgress,
}: {
  state: SaveState;
  signedIn: boolean;
  board: Board;
  rating: number;
  unit: string;
  onSave: () => void;
  onBoard: () => void;
  onProgress: () => void;
}) {
  const score = (
    <div className="summary-save__score">
      <span className="summary-save__num">{rating}</span>
      <span className="summary-save__unit">
        {unit} · «{boardTitle(board)}»
      </span>
    </div>
  );

  if (state.s === 'saved') {
    const { r } = state;
    const delta = r.prevLast === null ? null : r.result.rating - r.prevLast;
    return (
      <section className="summary__panel summary-save summary-save--done rise" aria-live="polite">
        <h2 className="summary__h">Сохранено в рейтинг</h2>
        <div className="summary-save__rank">
          <span className="summary-save__place">#{r.rank ?? '—'}</span>
          <span className="muted">
            из {r.players} в рейтинге «{boardTitle(board)}»
          </span>
        </div>
        <div className="summary-save__facts">
          {r.personalBest ? (
            <span className="summary-save__up">
              <Icon name="check" size={16} /> Это твой личный рекорд
            </span>
          ) : (
            <span>
              Личный рекорд: <b>{r.prevBest}</b> {unit}
            </span>
          )}
          {!r.personalBest && delta !== null && delta !== 0 && (
            <span className={delta > 0 ? 'summary-save__up' : 'summary-save__down'}>
              {delta > 0 ? `+${delta}` : delta} к прошлому разу
            </span>
          )}
        </div>
        <div className="summary-save__actions">
          <DwellButton size="sm" onSelect={onBoard}>
            <Icon name="trophy" size={18} /> Рейтинг
          </DwellButton>
          <DwellButton size="sm" onSelect={onProgress}>
            <Icon name="chart" size={18} /> Мой прогресс
          </DwellButton>
        </div>
      </section>
    );
  }
  return (
    <section className="summary__panel summary-save rise" style={order(9)}>
      <h2 className="summary__h">Сохрани результат в общий рейтинг</h2>
      {score}
      <p
        className={`summary-save__text ${state.s === 'error' ? 'is-error' : ''}`}
        role={state.s === 'error' ? 'alert' : undefined}
      >
        {state.s === 'error'
          ? state.msg
          : signedIn
            ? 'Увидишь своё место и прирост к прошлому разу.'
            : 'Войди или зарегистрируйся — займёт 30 секунд. Появятся рейтинг и личные рекорды.'}
      </p>
      <DwellButton className="summary-save__btn" onSelect={onSave} disabled={state.s === 'saving'}>
        <Icon name="trophy" size={18} />{' '}
        {state.s === 'saving' ? 'Сохраняем…' : state.s === 'error' ? 'Ещё раз' : 'Сохранить'}
      </DwellButton>
    </section>
  );
}

/** Крупное кольцо «чистых» — главный итог подхода. */
function CleanRing({ pct }: { pct: number }) {
  const n = useCountUp(pct, 1200, 200);
  const R = 52;
  const C = 2 * Math.PI * R;
  const tone = pct >= 70 ? 'good' : pct >= 40 ? 'warn' : 'bad';
  return (
    <div className={`summary__ring summary__ring--${tone}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="summary__ring-track" cx="60" cy="60" r={R} />
        <circle
          className="summary__ring-bar"
          cx="60"
          cy="60"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - n / 100)}
        />
      </svg>
      <span className="summary__ring-text">
        <b>{n}%</b>
        <small>чистых</small>
      </span>
    </div>
  );
}

function Stat({
  i,
  label,
  value,
  format = String,
}: {
  i: number;
  label: string;
  value: number;
  format?: (n: number) => string;
}) {
  const n = useCountUp(value, 1000, 150 + i * 90);
  return (
    <div className="summary__stat rise" style={order(i)}>
      <span className="summary__stat-value">{format(n)}</span>
      <span className="summary__stat-label">{label}</span>
    </div>
  );
}
