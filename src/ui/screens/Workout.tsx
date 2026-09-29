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
        setHalf(null);
        flashRep(clean);
        setStreak((s) => (clean ? s + 1 : 0));
        if (clean) flashEdge('good');
        if (clean) {
          sfx.repClean();
          say(numberWord(e.count), 'count');
        } else sfx.repFlawed();
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
  const timeText = timeLimit ? formatDuration(timeLimit - elapsed) : formatDuration(elapsed);

  return (
    <main className="screen workout">
      <section className="workout__info card">
        {plan.items.length > 1 && (
          <span className="eyebrow">
            Упражнение {index + 1} из {plan.items.length}
          </span>
        )}
        <h2 className="workout__title">{meta.title}</h2>
        <div className={`workout__timer ${timeLimit && timeLimit - elapsed < 10 ? 'is-urgent' : ''}`}>
          <Icon name="timer" size={24} /> {timeText}
        </div>
        <div className="phasebar" aria-label={`Фаза движения: ${phaseLabel}`}>
          <div className="phasebar__track">
            {PHASES.map((p, i) => (
              <span key={p.id} className={i <= phaseIndex ? 'is-on' : ''} />
            ))}
          </div>
          <span className="phasebar__label">{phaseLabel}</span>
        </div>
      </section>

      <section className="workout__counter" aria-live="polite">
        <svg
          className={`workout__ring ${progress >= 0.8 ? 'is-near' : ''}`}
          viewBox="0 0 120 120"
          aria-hidden="true"
        >
          <circle cx="60" cy="60" r="52" className="workout__ring-track" />
          <circle
            cx="60"
            cy="60"
            r="52"
            pathLength="1"
            className="workout__ring-fill"
            style={{ strokeDashoffset: 1 - progress }}
          />
        </svg>
        <div className="workout__count">
          <span key={count} className="workout__num">
            {count}
          </span>
          <span className="workout__target">{timeLimit ? 'повторов' : `из ${item.target}`}</span>
          {item.exercise === 'lunge' && (
            <span key={half ?? 'none'} className="workout__half">
              {half === 'right'
                ? 'Правая ✓ — теперь левая'
                : half === 'left'
                  ? 'Левая ✓ — теперь правая'
                  : 'Правая + левая = 1'}
            </span>
          )}
        </div>
        {lastScore !== null && (
          <span className="workout__score" style={{ color: scoreColor(lastScore) }} key={`s${count}`}>
            {lastScore}
            <small>/100</small>
          </span>
        )}
        {count > 0 && <span key={`w${count}`} className="workout__shock" aria-hidden="true" />}
        {lastScore !== null && (
          <span
            key={`f${count}`}
            className="workout__float"
            style={{ color: scoreColor(lastScore) }}
            aria-hidden="true"
          >
            +{lastScore}
          </span>
        )}
      </section>

      {streak >= 2 && (
        <div key={`st${streak}`} className="streak" aria-live="polite">
          <Icon name="zap" size={34} />
          <span>
            Серия <b>×{streak}</b>
          </span>
        </div>
      )}

      {edge && <div key={edge.id} className={`edge edge--${edge.tone}`} aria-hidden="true" />}

      {hint && (
        <div key={hint.id} className={`hint hint--${hint.tone}`} role="status">
          <Icon name={hint.tone === 'good' ? 'check' : 'alert'} size={40} />
          <span>{hint.text}</span>
        </div>
      )}

      {meta.handsUpToFinish && !timeLimit && (
        <p className="workout__exit muted">
          <Icon name="flag" size={20} /> Обе руки над головой — закончить
        </p>
      )}

      {paused && (
        <div className="pause" role="alert">
          <Icon name="user" size={64} />
          <h2>Пауза</h2>
          <p>{paused}</p>
          <p className="muted">Счёт продолжится, когда я снова тебя увижу</p>
        </div>
      )}
    </main>
  );
}
