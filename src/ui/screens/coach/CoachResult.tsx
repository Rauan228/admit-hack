// «ИИ анализирует» (ожидание ответа модели) и «Твой план» — готовая программа недели с выбором дня и стартом.

import { useEffect, useState } from 'react';
import {
  COACH_CATALOG,
  GOALS,
  PROGRAM_WEEKS,
  type CoachPlan,
  type CoachProfile,
} from '../../../shared/coach';
import { Ghost } from '../../components/Ghost';
import { DwellButton } from '../../components/dwell';
import { Icon } from '../../components/Icon';
import { WEEKDAYS, sessionKcal, sessionWeekdays, weekTarget } from '../../lib/coachPlan';
import { EXERCISE_META } from '../../lib/exercises';
import { order } from '../../lib/motion';
import { isDone, type CoachWorkout } from '../../store/coach';
import { plural } from './draft';
import { FlowSteps, Ring, Thumb } from './parts';

const THINKING = [
  'Изучаю твою анкету',
  'Учитываю ограничения',
  'Анализирую каталог упражнений',
  'Исключаю неподходящие упражнения',
  'Подбираю подходы и отдых',
  'Составляю план на неделю',
];

/** Пока модель думает (10–30 с): шаги по очереди, чтобы ожидание было понятным. */
export function CoachThinking({ profile }: { profile: CoachProfile }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, THINKING.length - 1)), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <main className="page coach">
      <div className="page__inner ch-inner">
        <FlowSteps at={3} />
        <section className="ch-think">
          <div className="ch-think__art" aria-hidden="true">
            <Ghost exercise="squat_press" sway className="ch-think__ghost" />
          </div>
          <div className="ch-think__copy">
            <h1 className="ch-title ch-title--xl">ИИ анализирует твои данные</h1>
            <p className="ch-sub">
              Это займёт 10–15 секунд. Подбираем упражнения из нашего каталога под цель «
              {GOALS[profile.goal].title.toLowerCase()}» — {profile.daysPerWeek} × {profile.minutesPerSession}{' '}
              мин в неделю.
            </p>
          </div>
          <ol className="ch-card ch-think__list" aria-live="polite">
            {THINKING.map((t, n) => (
              <li key={t} className={n < i ? 'is-done' : n === i ? 'is-active' : ''}>
                <span>{n < i ? <Icon name="check" size={14} /> : null}</span> {t}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}

export function CoachResult({
  plan,
  profile,
  history,
  week: initialWeek,
  day: initialDay,
  onStart,
  onEdit,
  onRebuild,
  onHome,
}: {
  plan: CoachPlan;
  profile: CoachProfile | null;
  history: CoachWorkout[];
  week: number;
  day?: number;
  onStart: (index: number, week: number) => void;
  onEdit: () => void;
  onRebuild: () => void;
  onHome: () => void;
}) {
  const weekdays = sessionWeekdays(plan);
  const [week, setWeek] = useState(initialWeek);
  const [sel, setSel] = useState(initialDay ?? 0);
  const s = plan.sessions[sel] ?? plan.sessions[0]!;
  const total = plan.sessions.length * PROGRAM_WEEKS;
  const doneCount = new Set(history.map((h) => `${h.week}:${h.index}`)).size;
  const pct = Math.round((doneCount / total) * 100);
  const steps = plan.progression
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  return (
    <main className="page coach">
      <div className="page__inner ch-inner ch-inner--wide">
        <button type="button" className="back-link" onClick={onHome}>
          <Icon name="back" size={16} /> К тренеру
        </button>

        <header className="ch-result__head rise" style={order(0)}>
          <span className="ch-result__icon" aria-hidden="true">
            <Icon name="sparkle" size={26} />
          </span>
          <div>
            <h1 className="ch-title">{plan.title}</h1>
            <p className="ch-sub">Мы собрали программу под твои цели, данные и ограничения.</p>
          </div>
          <div className="ch-result__actions">
            <button type="button" className="btn btn--sm" onClick={onEdit}>
              <Icon name="edit" size={16} /> Изменить анкету
            </button>
            <button type="button" className="btn btn--sm btn--primary" onClick={onRebuild}>
              <Icon name="retry" size={16} /> Пересобрать план
            </button>
          </div>
        </header>

        <div className="ch-result">
          <div className="ch-col">
            <section className="ch-card rise" style={order(1)}>
              <h2 className="ch-h">
                <Icon name="alert" size={18} className="ch-h__icon" /> Почему такой план?
              </h2>
              <p className="ch-text">{plan.summary}</p>
            </section>
            <section className="ch-card rise" style={order(2)}>
              <h2 className="ch-h">
                <Icon name="sparkle" size={18} className="ch-h__icon" /> Что я учёл
              </h2>
              <ul className="ch-checks">
                {plan.insights.map((t) => (
                  <li key={t}>
                    <Icon name="check" size={14} /> {t}
                  </li>
                ))}
              </ul>
            </section>
            {plan.warnings.length > 0 && (
              <section className="ch-card ch-warn rise" style={order(3)}>
                <h2 className="ch-h">
                  <Icon name="shield" size={18} /> Важно
                </h2>
                <ul>
                  {plan.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="ch-col ch-col--main">
            <section className="ch-card rise" style={order(2)}>
              <div className="ch-week">
                <h2 className="ch-h">
                  Неделя {week} из {PROGRAM_WEEKS}
                </h2>
                <div className="ch-week__nav">
                  <button
                    type="button"
                    aria-label="Прошлая неделя"
                    disabled={week <= 1}
                    onClick={() => setWeek(week - 1)}
                  >
                    <Icon name="back" size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Следующая неделя"
                    disabled={week >= PROGRAM_WEEKS}
                    onClick={() => setWeek(week + 1)}
                  >
                    <Icon name="chevron" size={16} />
                  </button>
                </div>
              </div>
              <div className="ch-days" role="tablist">
                {WEEKDAYS.map((d, wd) => {
                  const idx = weekdays.indexOf(wd);
                  return (
                    <button
                      key={d}
                      type="button"
                      role="tab"
                      disabled={idx < 0}
                      aria-selected={idx === sel}
                      className={`${idx === sel ? 'is-active' : ''} ${idx >= 0 && isDone(history, week, idx) ? 'is-done' : ''}`}
                      onClick={() => idx >= 0 && setSel(idx)}
                    >
                      {d}
                      <small>
                        {idx < 0 ? 'отдых' : isDone(history, week, idx) ? 'готово' : `день ${idx + 1}`}
                      </small>
                    </button>
                  );
                })}
              </div>

              <div className="ch-session__head">
                <div>
                  <h3>
                    День {sel + 1} <span>|</span> {s.title}
                  </h3>
                  <small>
                    {s.focus} · ~{s.minutes} минут
                    {profile ? ` · ≈${sessionKcal(s, profile.weightKg, week)} ккал` : ''}
                  </small>
                </div>
                <DwellButton variant="primary" className="ch-session__go" onSelect={() => onStart(sel, week)}>
                  {isDone(history, week, sel) ? 'Повторить' : 'Начать тренировку'}{' '}
                  <Icon name="chevron" size={18} />
                </DwellButton>
              </div>

              <ol className="ch-table">
                {s.items.map((it) => (
                  <li key={it.exercise}>
                    <Thumb exercise={it.exercise} />
                    <b className="ch-table__name">{EXERCISE_META[it.exercise].title}</b>
                    <span className="ch-table__dose">
                      {it.sets} × {weekTarget(it.exercise, it.target, week)}
                      {COACH_CATALOG[it.exercise].unit === 'sec' ? ' с' : ''}
                    </span>
                    <span className="ch-table__rest">
                      <Icon name="timer" size={14} /> {it.restSec} с
                    </span>
                    <small className="ch-table__note">{it.note}</small>
                  </li>
                ))}
              </ol>
            </section>

            {plan.excluded.length > 0 && (
              <section className="ch-card rise" style={order(4)}>
                <h2 className="ch-h">Убрано из плана · {plan.excluded.length}</h2>
                <ul className="ch-excluded">
                  {plan.excluded.map((e) => (
                    <li key={e.exercise}>
                      <b>{EXERCISE_META[e.exercise].title}</b>
                      <small>{e.reason}</small>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="ch-col">
            <section className="ch-card ch-progress-mini rise" style={order(3)}>
              <h2 className="ch-h">
                <Icon name="chart" size={18} className="ch-h__icon" /> Мой прогресс
              </h2>
              <Ring
                pct={pct}
                sub={`${doneCount} из ${total} ${plural(total, 'тренировки', 'тренировок', 'тренировок')}`}
              />
            </section>
            {steps.length > 0 && (
              <section className="ch-card rise" style={order(4)}>
                <h2 className="ch-h">
                  <Icon name="activity" size={18} className="ch-h__icon" /> Как расти дальше?
                </h2>
                <ul className="ch-checks">
                  {steps.map((t) => (
                    <li key={t}>
                      <Icon name="check" size={14} /> {t}
                    </li>
                  ))}
                  <li>
                    <Icon name="check" size={14} /> Каждую неделю цели подходов растут на 10% — сами.
                  </li>
                </ul>
              </section>
            )}
            {plan.tips.length > 0 && (
              <section className="ch-card rise" style={order(5)}>
                <h2 className="ch-h">
                  <Icon name="leaf" size={18} className="ch-h__icon" /> Советы
                </h2>
                <ul className="ch-checks ch-checks--muted">
                  {plan.tips.map((t) => (
                    <li key={t}>
                      <Icon name="zap" size={14} /> {t}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        <p className="ch-disclaimer">
          План составляет ИИ по твоей анкете. Он не заменяет врача: при болезнях и травмах посоветуйся со
          специалистом. Если во время упражнения больно — остановись.
        </p>
      </div>
    </main>
  );
}
