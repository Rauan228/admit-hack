// U-08 + U-09 + U-16: экран подхода. Всё, что видит человек во время упражнения:
// счётчик и цель, оценка повтора, фаза, таймер, подсказка техники (текст + голос + сустав + стрелка),
// пауза, если человек вышел из кадра. Итоги приходят от движка (set_complete); досрочно
// («обе руки вверх») или по таймеру челленджа — собираем сами из событий rep.

import { useEffect, useRef, useState } from 'react';
import type { Phase, Severity } from '../../engine/types';
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

  useEngineEvents((e) => {
    if (finished.current) return;
    switch (e.type) {
      case 'phase':
        setPhase(e.phase);
        break;
      case 'form_error':
        showFormError(e);
        showHint(e.message, e.severity);
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
        flashRep(clean);
        if (clean) {
          sfx.repClean();
          say(numberWord(e.count), 'count');
        } else sfx.repFlawed();
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

  const progress = timeLimit ? Math.min(1, elapsed / timeLimit) : Math.min(1, count / item.target);
  const timeText = timeLimit ? formatDuration(timeLimit - elapsed) : formatDuration(elapsed);

  return (
    <main className="screen workout">
      <section className="workout__info card">
        {plan.items.length > 1 && (
          <span className="badge badge--primary">
            {index + 1} / {plan.items.length}
          </span>
        )}
        <h2 className="workout__title">{meta.title}</h2>
        <div className={`workout__timer ${timeLimit && timeLimit - elapsed < 10 ? 'is-urgent' : ''}`}>
          <Icon name="timer" size={24} /> {timeText}
        </div>
        <ol className="workout__phases" aria-label="Фаза движения">
          {PHASES.map((p) => (
            <li key={p.id} className={p.id === phase ? 'is-active' : ''}>
              {p.label}
            </li>
          ))}
        </ol>
      </section>

      <section className="workout__counter" aria-live="polite">
        <svg className="workout__ring" viewBox="0 0 120 120" aria-hidden="true">
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
        </div>
        {lastScore !== null && (
          <span className="workout__score" style={{ color: scoreColor(lastScore) }} key={`s${count}`}>
            {lastScore}
            <small>/100</small>
          </span>
        )}
      </section>

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
