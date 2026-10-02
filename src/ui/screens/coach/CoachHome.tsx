// Главная ИИ-тренера. Без плана — что это и «Создать план» + готовые цели.
// С планом — сегодняшняя тренировка, прогресс, неделя, цель, план по неделям, рекомендации, ограничения.

import { useState } from 'react';
import {
  COACH_EXERCISES,
  GOALS,
  LIMITS,
  PROGRAM_WEEKS,
  type CoachPlan,
  type CoachProfile,
  type Goal,
} from '../../../shared/coach';
import { DwellButton } from '../../components/dwell';
import { Ghost } from '../../components/Ghost';
import { Icon, type IconName } from '../../components/Icon';
import {
  WEEKDAYS,
  sessionKcal,
  sessionLevel,
  sessionWeekdays,
  todayIndex,
  weekOf,
  weekTarget,
} from '../../lib/coachPlan';
import { EXERCISE_META } from '../../lib/exercises';
import { order } from '../../lib/motion';
import { isDone, type CoachWorkout } from '../../store/coach';
import { GOAL_ICON, plural } from './draft';
import { Spark, Thumb } from './parts';

const PERKS: { icon: IconName; text: string }[] = [
  { icon: 'shield', text: 'Учитывает твои данные и ограничения' },
  { icon: 'list', text: `Подбирает упражнения из ${COACH_EXERCISES.length} вариантов` },
  { icon: 'activity', text: 'Растит нагрузку неделя за неделей' },
];

const CREATE_LIST = [
  'Твоя цель и уровень',
  'Физические параметры',
  'Ограничения по здоровью',
  'Сколько времени есть на тренировки',
  `Индивидуальный план из ${COACH_EXERCISES.length} упражнений`,
];

const TIP_ICONS: IconName[] = ['leaf', 'heart', 'droplet', 'moon'];

type Next = { index: number; week: number; kind: 'today' | 'next' | 'missed' | 'done' };

/** Что делать сейчас: сегодняшний день → ближайший впереди → пропущенный на этой неделе → первый следующей недели. */
function nextWorkout(plan: CoachPlan, history: CoachWorkout[], week: number): Next {
  const wds = sessionWeekdays(plan);
  const today = todayIndex();
  const open = (i: number) => !isDone(history, week, i);
  const t = wds.indexOf(today);
  if (t >= 0 && open(t)) return { index: t, week, kind: 'today' };
  const ahead = wds
    .map((wd, i) => ({ wd, i }))
    .filter((d) => d.wd > today && open(d.i))
    .sort((a, b) => a.wd - b.wd)[0];
  if (ahead) return { index: ahead.i, week, kind: 'next' };
  const missed = plan.sessions.findIndex((_, i) => open(i));
  if (missed >= 0) return { index: missed, week, kind: 'missed' };
  const first = wds.map((wd, i) => ({ wd, i })).sort((a, b) => a.wd - b.wd)[0]?.i ?? 0;
  return { index: first, week: Math.min(PROGRAM_WEEKS, week + 1), kind: 'done' };
}

export function CoachHome({
  plan,
  profile,
  history,
  onCreate,
  onEdit,
  onStart,
  onOpen,
  onBack,
}: {
  plan: CoachPlan | null;
  profile: CoachProfile | null;
  history: CoachWorkout[];
  /** Анкета с нуля (с выбранной целью — сразу к данным). */
  onCreate: (goal?: Goal) => void;
  /** Изменить анкету на шаге step. */
  onEdit: (step: number) => void;
  onStart: (index: number, week: number) => void;
  /** Открыть план на неделе и дне. */
  onOpen: (week: number, day: number) => void;
  onBack: () => void;
}) {
  const week = plan ? weekOf(plan) : 1;
  const [tab, setTab] = useState(week);
  const next = plan ? nextWorkout(plan, history, week) : null;

  return (
    <main className="page coach">
      <div className="page__inner ch-inner ch-inner--wide">
        <button type="button" className="back-link" onClick={onBack}>
          <Icon name="back" size={16} /> В меню
        </button>

        <section className="ch-hero rise" style={order(0)}>
          <div className="ch-hero__text">
            <span className="ch-kicker">
              <Icon name="sparkle" size={16} /> ИИ-тренер
            </span>
            <h1 className="ch-title ch-title--hero">Твой персональный план тренировок</h1>
            <p className="ch-sub">
              План, который подстраивается под твои цели, возможности и прогресс. ИИ подбирает упражнения из
              нашего каталога и корректирует их под тебя.
            </p>
            <div className="ch-hero__actions">
              {plan && next ? (
                <>
                  <DwellButton variant="primary" size="lg" onSelect={() => onStart(next.index, next.week)}>
                    Продолжить тренировку <Icon name="chevron" size={18} />
                  </DwellButton>
                  <DwellButton size="lg" onSelect={() => onEdit(0)}>
                    Настроить план
                  </DwellButton>
                </>
              ) : (
                <DwellButton variant="primary" size="lg" onSelect={() => onCreate()}>
                  Создать план <Icon name="chevron" size={18} />
                </DwellButton>
              )}
            </div>
          </div>
          {/* Крупный план: голова и торс вполоборота, тёмное тело с тёплой подсветкой (фильтр в CSS). */}
          <div className="ch-hero__art" aria-hidden="true">
            <Ghost exercise="calf_raise" still phase={0} yaw={-0.55} className="ch-hero__ghost" />
          </div>
          <ul className="ch-hero__perks">
            {PERKS.map((p) => (
              <li key={p.text}>
                <span>
                  <Icon name={p.icon} size={20} />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </section>

        {plan && next ? (
          <PlanDashboard
            plan={plan}
            profile={profile}
            history={history}
            week={week}
            next={next}
            tab={tab}
            onTab={setTab}
            onEdit={onEdit}
            onStart={onStart}
            onOpen={onOpen}
          />
        ) : (
          <>
            <section className="ch-create rise" style={order(1)}>
              <div className="ch-create__main">
                <span className="ch-create__icon" aria-hidden="true">
                  <Icon name="target" size={30} />
                </span>
                <div>
                  <h2 className="ch-title">Создать новый план</h2>
                  <p className="ch-sub">
                    Расскажи о себе — и я подготовлю программу на {PROGRAM_WEEKS} недели.
                  </p>
                </div>
                <DwellButton
                  variant="primary"
                  size="lg"
                  className="ch-create__go"
                  onSelect={() => onCreate()}
                >
                  Начать <Icon name="chevron" size={18} />
                </DwellButton>
              </div>
              <ul className="ch-checks ch-create__list">
                {CREATE_LIST.map((t) => (
                  <li key={t}>
                    <Icon name="check" size={14} /> {t}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rise" style={order(2)}>
              <h2 className="ch-h ch-h--section">Готовые цели</h2>
              <div className="ch-presets">
                {(Object.keys(GOALS) as Goal[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`ch-preset ch-goal--${g}`}
                    onClick={() => onCreate(g)}
                  >
                    <span className="ch-goal__icon">
                      <Icon name={GOAL_ICON[g]} size={24} />
                    </span>
                    <b>{GOALS[g].title}</b>
                    <small>{GOALS[g].sub}</small>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="ch-limits-banner rise" style={order(9)}>
          <span className="ch-limits-banner__icon" aria-hidden="true">
            <Icon name="shield" size={22} />
          </span>
          <div>
            <b>
              {profile && profile.limits.length > 0
                ? `Учтено: ${profile.limits.map((l) => LIMITS[l].title.toLowerCase()).join(', ')}`
                : 'Есть ограничения по здоровью?'}
            </b>
            <small>Укажи их — и я исключу неподходящие упражнения.</small>
          </div>
          <button type="button" className="btn" onClick={() => (plan ? onEdit(2) : onCreate())}>
            {profile && profile.limits.length > 0 ? 'Изменить ограничения' : 'Добавить ограничения'}
          </button>
        </section>
      </div>
    </main>
  );
}

function PlanDashboard({
  plan,
  profile,
  history,
  week,
  next,
  tab,
  onTab,
  onEdit,
  onStart,
  onOpen,
}: {
  plan: CoachPlan;
  profile: CoachProfile | null;
  history: CoachWorkout[];
  week: number;
  next: Next;
  tab: number;
  onTab: (w: number) => void;
  onEdit: (step: number) => void;
  onStart: (index: number, week: number) => void;
  onOpen: (week: number, day: number) => void;
}) {
  const s = plan.sessions[next.index]!;
  const wds = sessionWeekdays(plan);
  const today = todayIndex();
  const shown = s.items.slice(0, 3);
  const more = s.items.length - shown.length;
  const reps = history.reduce((a, h) => a + h.reps, 0);
  const clean = history.reduce((a, h) => a + h.cleanReps, 0);
  const minutes = Math.round(history.reduce((a, h) => a + h.durationSec, 0) / 60);
  const total = plan.sessions.length * PROGRAM_WEEKS;
  const doneCount = new Set(history.map((h) => `${h.week}:${h.index}`)).size;
  const goalPct = Math.round((doneCount / total) * 100);
  const goal = profile?.goal ?? 'tone';
  const thisWeek = plan.sessions.filter((_, i) => isDone(history, week, i)).length;
  const heading =
    next.kind === 'today'
      ? 'Сегодняшняя тренировка'
      : next.kind === 'done'
        ? 'Неделя выполнена — дальше'
        : `Следующая тренировка · ${WEEKDAYS[wds[next.index] ?? 0]}`;
  const advice =
    history.length === 0
      ? 'Начни с первой тренировки — после неё я посмотрю на твою технику и подскажу, что подтянуть.'
      : `Ты выполнил ${history.length} ${plural(history.length, 'тренировку', 'тренировки', 'тренировок')}, чистых повторов — ${
          reps ? Math.round((clean / reps) * 100) : 0
        }%. ${week < PROGRAM_WEEKS ? 'На следующей неделе цели подходов вырастут на 10%.' : 'Это последняя неделя программы — дожми!'}`;

  return (
    <>
      <div className="ch-grid ch-grid--top">
        <section className="ch-card ch-today rise" style={order(1)}>
          <header className="ch-card__head">
            <div>
              <h2 className="ch-h">{heading}</h2>
              <small>
                Неделя {next.week} из {PROGRAM_WEEKS} · {GOALS[goal].title}
              </small>
            </div>
            <span className="ch-chip">День {next.index + 1}</span>
          </header>
          <div className="ch-tiles">
            {shown.map((it, i) => (
              <div key={it.exercise} className={`ch-tile ${i === 0 ? 'is-first' : ''}`}>
                <span className="ch-tile__num">{i + 1}</span>
                <Thumb exercise={it.exercise} size="lg" />
                <b>{EXERCISE_META[it.exercise].title}</b>
                <small>
                  {it.sets} {plural(it.sets, 'подход', 'подхода', 'подходов')} ·{' '}
                  {weekTarget(it.exercise, it.target, next.week)}{' '}
                  {EXERCISE_META[it.exercise].unit === 'sec' ? 'сек' : 'повторений'}
                </small>
              </div>
            ))}
            {more > 0 && (
              <button
                type="button"
                className="ch-tile ch-tile--more"
                onClick={() => onOpen(next.week, next.index)}
              >
                <Icon name="plus" size={22} />
                <small>
                  Ещё {more} {plural(more, 'упражнение', 'упражнения', 'упражнений')}
                </small>
              </button>
            )}
          </div>
          <div className="ch-today__foot">
            <span className="ch-stat">
              <Icon name="timer" size={20} />
              <span>
                <b>~{s.minutes} минут</b>
                <small>Длительность</small>
              </span>
            </span>
            {profile && (
              <span className="ch-stat">
                <Icon name="flame" size={20} />
                <span>
                  <b>≈ {sessionKcal(s, profile.weightKg, next.week)} ккал</b>
                  <small>Примерный расход</small>
                </span>
              </span>
            )}
            <span className="ch-stat">
              <Icon name="chart" size={20} />
              <span>
                <b>{sessionLevel(s)}</b>
                <small>Сложность</small>
              </span>
            </span>
            <DwellButton
              variant="primary"
              className="ch-today__go"
              onSelect={() => onStart(next.index, next.week)}
            >
              Начать тренировку <Icon name="chevron" size={18} />
            </DwellButton>
          </div>
        </section>

        <section className="ch-card ch-progress rise" style={order(2)}>
          <header className="ch-card__head">
            <h2 className="ch-h">Мой прогресс</h2>
            <span className="ch-chip">
              {PROGRAM_WEEKS} {plural(PROGRAM_WEEKS, 'неделя', 'недели', 'недель')}
            </span>
          </header>
          <div className="ch-metrics">
            <div>
              <b>{history.length}</b>
              <small>{plural(history.length, 'тренировка', 'тренировки', 'тренировок')}</small>
            </div>
            <div>
              <b>{reps ? Math.round((clean / reps) * 100) : 0}%</b>
              <small>чистых повторов</small>
            </div>
            <div>
              <b>{minutes}</b>
              <small>мин в движении</small>
            </div>
          </div>
          <div className="ch-chart">
            <span className="ch-chart__label">Чистые повторы за тренировку</span>
            {history.length >= 2 ? (
              <Spark values={history.slice(-8).map((h) => h.cleanReps)} />
            ) : (
              <p className="ch-empty">График появится после двух тренировок по плану.</p>
            )}
          </div>
        </section>
      </div>

      <div className="ch-grid ch-grid--mid">
        <section className="ch-calendar rise" style={order(3)} aria-label="Неделя">
          {WEEKDAYS.map((d, wd) => {
            const idx = wds.indexOf(wd);
            const done = idx >= 0 && isDone(history, week, idx);
            const isToday = wd === today;
            const status =
              idx < 0
                ? 'Отдых'
                : done
                  ? 'Выполнено'
                  : isToday
                    ? 'Сегодня'
                    : wd < today
                      ? 'Пропущено'
                      : 'Тренировка';
            return (
              <button
                key={d}
                type="button"
                disabled={idx < 0}
                className={`ch-dayc ${isToday ? 'is-today' : ''} ${done ? 'is-done' : ''} ${idx < 0 ? 'is-rest' : ''}`}
                onClick={() => idx >= 0 && onOpen(week, idx)}
              >
                <b>{d}</b>
                <small>
                  <i aria-hidden="true">{done && <Icon name="check" size={10} />}</i> {status}
                </small>
              </button>
            );
          })}
        </section>

        <section className="ch-card ch-goalcard rise" style={order(4)}>
          <header className="ch-card__head">
            <h2 className="ch-h">Моя цель</h2>
            <button type="button" className="ch-link" onClick={() => onEdit(0)}>
              Изменить <Icon name="chevron" size={14} />
            </button>
          </header>
          <div className="ch-goalcard__row">
            <span className={`ch-goal__icon ch-goal--${goal}`}>
              <Icon name={GOAL_ICON[goal]} size={22} />
            </span>
            <span>
              <b>{GOALS[goal].title}</b>
              <small>
                {profile?.targetKg
                  ? `${profile.weightKg} → ${profile.targetKg} кг`
                  : `${plan.sessions.length} × в неделю`}{' '}
                · {PROGRAM_WEEKS} недели · выполнено {thisWeek}/{plan.sessions.length} на этой неделе
              </small>
            </span>
            <b className="ch-goalcard__pct">{goalPct}%</b>
          </div>
          <div className="ch-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(2, goalPct)}%` }} />
          </div>
        </section>
      </div>

      <div className="ch-grid ch-grid--bottom">
        <section className="ch-card ch-plan rise" style={order(5)}>
          <header className="ch-card__head">
            <h2 className="ch-h">Мой план</h2>
          </header>
          <div className="ch-tabs" role="tablist">
            {Array.from({ length: PROGRAM_WEEKS }, (_, i) => i + 1).map((w) => (
              <button
                key={w}
                type="button"
                role="tab"
                aria-selected={tab === w}
                className={tab === w ? 'is-active' : ''}
                onClick={() => onTab(w)}
              >
                Неделя {w}
              </button>
            ))}
          </div>
          <ol className="ch-rows">
            {plan.sessions.map((ss, i) => {
              const done = isDone(history, tab, i);
              const locked = tab > week;
              const current = tab === next.week && i === next.index;
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={`ch-rowc ${current ? 'is-current' : ''}`}
                    onClick={() => onOpen(tab, i)}
                  >
                    <span className={`ch-rowc__state ${done ? 'is-done' : current ? 'is-current' : ''}`}>
                      {done ? (
                        <Icon name="check" size={14} />
                      ) : locked ? (
                        <Icon name="lock" size={14} />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span className="ch-rowc__day">
                      {WEEKDAYS[wds[i] ?? 0]} · День {i + 1}
                    </span>
                    <span className="ch-rowc__title">{ss.title}</span>
                    <span className="ch-rowc__thumbs">
                      {ss.items.slice(0, 3).map((it) => (
                        <Thumb key={it.exercise} exercise={it.exercise} size="sm" />
                      ))}
                    </span>
                    <span className="ch-rowc__meta">
                      {ss.items.length} {plural(ss.items.length, 'упражнение', 'упражнения', 'упражнений')} ·{' '}
                      {ss.minutes} мин
                    </span>
                    <Icon name="chevron" size={16} className="ch-rowc__chev" />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="ch-card ch-ai rise" style={order(6)}>
          <header className="ch-card__head">
            <h2 className="ch-h">
              <Icon name="sparkle" size={18} className="ch-h__icon" /> ИИ-рекомендации
            </h2>
          </header>
          <div className="ch-ai__main">
            <div className="ch-ai__msg">
              <b>{history.length === 0 ? 'План готов!' : 'Отличный прогресс!'}</b>
              <p>{advice}</p>
              <button type="button" className="btn btn--sm" onClick={() => onOpen(week, next.index)}>
                Открыть план
              </button>
            </div>
            <div className="ch-ai__art" aria-hidden="true">
              <Ghost exercise="arm_raise" still phase={0.1} yaw={0} className="ch-ai__ghost" />
            </div>
          </div>
          <ul className="ch-ai__tips">
            {plan.tips.slice(0, 3).map((t, i) => (
              <li key={t}>
                <span>
                  <Icon name={TIP_ICONS[i] ?? 'zap'} size={18} />
                </span>
                <small>{t}</small>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
