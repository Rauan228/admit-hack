// U-08 + U-09 + U-16: экран подхода. Всё, что видит человек во время упражнения:
// счётчик и цель, оценка повтора, фаза, таймер, подсказка техники (текст + голос + сустав + стрелка),
// пауза, если человек вышел из кадра. Итоги приходят от движка (set_complete); досрочно
// («обе руки вверх») или по таймеру челленджа — собираем сами из событий rep.

import { useEffect, useRef, useState } from 'react';
import type { Phase, Severity, Side } from '../../engine/types';
import { numberWord, say } from '../audio/voice';
import { sfx } from '../audio/sfx';
import { Icon } from '../components/Icon';
import { restartEngineMode, useEngineEvents } from '../engine/bus';
import { clearFormError, flashRep, showFormError } from '../engine/overlay';
import { EXERCISE_META, type Plan } from '../lib/exercises';
import { SetAccumulator, formatDuration, type SetResult } from '../lib/results';
import { scoreColor } from '../theme';
import './Workout.css';

const PHASES: { id: Phase; label: string }[] = [
  { id: 'start', label: 'Старт' },
  { id: 'down', label: 'Вниз' },
  { id: 'bottom', label: 'Низ' },
  { id: 'up', label: 'Вверх' },
];

const HINT_MS = 3400;
const PRAISE_MS = 1300;

interface Hint {
  id: number;
  text: string;
  tone: Severity | 'good';
}

export function Workout({
  plan,
  index,
  onDone,
}: {
  plan: Plan;
  index: number;
  onDone: (r: SetResult) => void;
}) {
  const item = plan.items[index] ?? plan.items[0]!;
  const meta = EXERCISE_META[item.exercise];
  const timeLimit = plan.timeLimitSec;

  const [count, setCount] = useState(0);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('start');
  const [hint, setHint] = useState<Hint | null>(null);
  const [paused, setPaused] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** Выпады: какая нога уже сделана в текущей паре. */
  const [half, setHalf] = useState<Side | null>(null);
  /** Серия чистых повторов подряд. */
  const [streak, setStreak] = useState(0);
  /** Вспышка краёв экрана: зелёная на чистый повтор, красная на ошибку. */
  const [edge, setEdge] = useState<{ id: number; tone: 'good' | 'bad' | 'warn' } | null>(null);
  /** Оценки повторов по порядку — только для мини-графика. */
  const [scores, setScores] = useState<number[]>([]);

  const acc = useRef(new SetAccumulator());
  const finished = useRef(false);
  const hintId = useRef(0);

  const finish = (result: SetResult) => {
    if (finished.current) return;
    finished.current = true;
    clearFormError();
    onDone(result);
  };
  const finishEarly = () =>
    finish({
      exercise: item.exercise,
      target: item.target,
      stats: acc.current.stats(),
      endedEarly: !timeLimit,
    });

  useEffect(() => {
    restartEngineMode({ exercise: item.exercise, targetReps: item.target });
    const t0 = performance.now();
    const id = setInterval(() => setElapsed((performance.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, [item.exercise, item.target]);

  // Челлендж: подход заканчивает таймер.
  useEffect(() => {
    if (timeLimit && elapsed >= timeLimit) finishEarly();
  });

  // Подсказка сама гаснет.
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(
      () => setHint((h) => (h?.id === hint.id ? null : h)),
      hint.tone === 'good' ? PRAISE_MS : HINT_MS,
    );
    return () => clearTimeout(t);
  }, [hint]);

  const showHint = (text: string, tone: Hint['tone']) => {
    hintId.current += 1;
    setHint({ id: hintId.current, text, tone });
  };
  const flashEdge = (tone: 'good' | 'bad' | 'warn') => {
    hintId.current += 1;
    setEdge({ id: hintId.current, tone });
  };

  useEngineEvents((e) => {
    if (finished.current) return;
    switch (e.type) {
      case 'phase':
        setPhase(e.phase);
        break;
      case 'form_error':
        showFormError(e);
        showHint(e.message, e.severity);
        flashEdge(e.severity);
        sfx.error();
        say(e.message, 'hint');
        break;
      case 'form_ok':
        clearFormError();
        showHint('Отлично! Чистое повторение', 'good');
        break;
      case 'rep': {
        acc.current.addRep(e.score, e.errors);
        const clean = e.errors.length === 0;
        setCount(e.count);
        setLastScore(e.score);
        setScores((l) => [...l, e.score]);
        setHalf(null);
        // Планка: «повтор» — каждая секунда удержания; вспышка и голос — раз в 5 секунд, а не каждую.
        const quiet = meta.unit === 'sec' && e.count % 5 !== 0;
        if (!quiet || !clean) flashRep(clean);
        setStreak((s) => (clean ? s + 1 : 0));
        if (clean && !quiet) flashEdge('good');
        if (clean && !quiet) {
          sfx.repClean();
          say(numberWord(e.count), 'count');
        } else if (!clean) sfx.repFlawed();
        break;
      }
      case 'half_rep': {
        // Одна нога готова: пара ещё не закрыта. После rep строка сбрасывается.
        const clean = e.errors.length === 0;
        setHalf((h) => (h && h !== e.side ? null : e.side));
        flashRep(clean);
        sfx.tick();
        if (clean) say(e.side === 'right' ? 'Теперь левой' : 'Теперь правой', 'count');
        break;
      }
      case 'set_complete':
        if (!timeLimit)
          finish({ exercise: e.exercise, target: item.target, stats: e.stats, endedEarly: false });
        break;
      case 'calibration':
        if (e.status === 'ok') setPaused(null);
        else {
          setPaused(e.hint);
          say(e.hint, 'hint');
        }
        break;
      case 'gesture':
        if (e.name === 'both_hands_up' && meta.handsUpToFinish) finishEarly();
        break;
    }
  });

  const phaseIndex = Math.max(
    0,
    PHASES.findIndex((p) => p.id === phase),
  );
  const phaseLabel = PHASES[phaseIndex]?.label ?? '';
  const progress = timeLimit ? Math.min(1, elapsed / timeLimit) : Math.min(1, count / item.target);
  const timeText = timeLimit
    ? `${formatDuration(elapsed)} / ${formatDuration(timeLimit)}`
    : formatDuration(elapsed);
  // Точки подхода — когда цель небольшая; иначе (планка, челлендж) — сплошная полоса.
  const pips = !timeLimit && item.target <= 20 ? item.target : 0;
  const recent = scores.slice(-12);
  const hintLabel = hint?.tone === 'good' ? 'Чисто' : hint?.tone === 'warn' ? 'Подсказка' : 'Ошибка техники';

  return (
    <main className="screen workout">
      <section className="wk-count wk-panel" aria-live="polite">
        <span className="wk-label">
          {plan.items.length > 1 ? `Упражнение ${index + 1} из ${plan.items.length}` : 'Подход'}
        </span>
        <h2 className="wk-count__title">{meta.title}</h2>
        <div className="wk-count__value">
          <span key={count} className="wk-count__num">
            {count}
          </span>
          <span className="wk-count__of">
            {timeLimit ? 'повторов' : meta.unit === 'sec' ? `из ${item.target} сек` : `из ${item.target}`}
          </span>
        </div>
        {item.exercise === 'lunge' && (
          <span key={half ?? 'none'} className="wk-count__half">
            {half === 'right'
              ? 'Правая ✓ — теперь левая'
              : half === 'left'
                ? 'Левая ✓ — теперь правая'
                : 'Правая + левая = 1'}
          </span>
        )}
      </section>

      <aside className="wk-side">
        <div key={`s${count}`} className={`wk-score wk-panel ${lastScore !== null ? 'is-flash' : ''}`}>
          <svg className="wk-score__ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="42" className="wk-score__track" />
            <circle
              cx="50"
              cy="50"
              r="42"
              pathLength="1"
              className="wk-score__fill"
              style={{
                strokeDashoffset: 1 - (lastScore ?? 0) / 100,
                stroke: lastScore !== null ? scoreColor(lastScore) : undefined,
              }}
            />
          </svg>
          <div className="wk-score__body">
            <span
              className="wk-score__num"
              style={lastScore !== null ? { color: scoreColor(lastScore) } : undefined}
            >
              {lastScore !== null ? `+${lastScore}` : '—'}
            </span>
            <span className="wk-score__label">Оценка повтора</span>
          </div>
        </div>

        <div className="wk-phase wk-panel" aria-label={`Фаза движения: ${phaseLabel}`}>
          <span className="wk-label">Фаза движения</span>
          <b className="wk-phase__value">{phaseLabel}</b>
          <div className="wk-phase__track">
            {PHASES.map((p, i) => (
              <span key={p.id} className={i <= phaseIndex ? 'is-on' : ''} />
            ))}
          </div>
          {recent.length > 0 && (
            <div className="wk-bars" aria-hidden="true">
              {recent.map((v, i) => (
                <i
                  key={scores.length - recent.length + i}
                  style={{ height: `${Math.max(8, v)}%`, background: scoreColor(v) }}
                />
              ))}
            </div>
          )}
        </div>

        {streak >= 2 && (
          <div key={`st${streak}`} className="streak" aria-live="polite">
            <Icon name="zap" size={20} />
            <span>
              Серия <b>×{streak}</b>
            </span>
          </div>
        )}
      </aside>

      {edge && <div key={edge.id} className={`edge edge--${edge.tone}`} aria-hidden="true" />}

      {hint && (
        <div key={hint.id} className={`hint hint--${hint.tone}`} role="status">
          <span className="hint__icon">
            <Icon name={hint.tone === 'good' ? 'check' : 'alert'} size={26} />
          </span>
          <span className="hint__body">
            <span className="hint__label">{hintLabel}</span>
            <span className="hint__text">{hint.text}</span>
          </span>
        </div>
      )}

      <section className="wk-bottom wk-panel">
        <div className={`wk-timer ${timeLimit && timeLimit - elapsed < 10 ? 'is-urgent' : ''}`}>
          <Icon name="timer" size={20} />
          <span>{timeText}</span>
        </div>
        <div className="wk-progress">
          <span className="wk-label">Прогресс подхода</span>
          {pips > 0 ? (
            <div className="wk-pips">
              {Array.from({ length: pips }, (_, i) => (
                <i key={i} className={i < count ? 'is-done' : i === count ? 'is-next' : ''} />
              ))}
            </div>
          ) : (
            <div className="wk-bar">
              <span style={{ transform: `scaleX(${progress})` }} />
            </div>
          )}
        </div>
        {meta.handsUpToFinish && !timeLimit && (
          <p className="wk-exit">
            <Icon name="flag" size={18} /> Обе руки над головой — закончить
          </p>
        )}
      </section>

      {paused && (
        <div className="pause" role="alert">
          <div className="pause__card">
            <span className="pause__icon">
              <Icon name="user" size={36} />
            </span>
            <span className="wk-label">Нет в кадре</span>
            <h2>Пауза</h2>
            <p>{paused}</p>
            <p className="muted">Счёт продолжится, когда я снова тебя увижу</p>
          </div>
        </div>
      )}
    </main>
  );
}
