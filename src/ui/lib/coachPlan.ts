// Расчёты для ИИ-плана в UI: неделя программы, дни недели, цели по неделям, калории, сложность.
// Модель даёт план одной недели; программа — PROGRAM_WEEKS недель, каждую неделю цели растут на 10%.

import {
  COACH_CATALOG,
  PROGRAM_WEEKS,
  type CoachExercise,
  type CoachPlan,
  type PlanSession,
} from '../../shared/coach';

const DAY_MS = 86_400_000;
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

/** Полночь понедельника той недели, где лежит t (по местному времени). */
function mondayOf(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - ((d.getDay() + 6) % 7) * DAY_MS;
}

/** Неделя программы сейчас: 1…PROGRAM_WEEKS (после конца — последняя). */
export function weekOf(plan: CoachPlan, now = Date.now()): number {
  const w = Math.floor((mondayOf(now) - mondayOf(plan.createdAt)) / (7 * DAY_MS)) + 1;
  return Math.min(PROGRAM_WEEKS, Math.max(1, w));
}

/** День недели сегодня: 0 — понедельник. */
export const todayIndex = (now = Date.now()) => (new Date(now).getDay() + 6) % 7;

const PREFIX: [string, number][] = [
  ['пн', 0],
  ['пон', 0],
  ['вт', 1],
  ['ср', 2],
  ['чт', 3],
  ['чет', 3],
  ['пт', 4],
  ['пят', 4],
  ['сб', 5],
  ['суб', 5],
  ['вс', 6],
  ['вос', 6],
];
const SPREAD: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

/** День недели каждой тренировки: из подписи модели («Пн»), а если не разобрать — равномерно по неделе. */
export function sessionWeekdays(plan: CoachPlan): number[] {
  const parsed = plan.sessions.map((s) => {
    const d = s.day.trim().toLowerCase();
    return PREFIX.find(([p]) => d.startsWith(p))?.[1] ?? -1;
  });
  if (parsed.every((d) => d >= 0) && new Set(parsed).size === parsed.length) return parsed;
  return SPREAD[plan.sessions.length] ?? plan.sessions.map((_, i) => i % 7);
}

/** Цель подхода на неделе программы: +10% в неделю, не выше верхней границы каталога. */
export function weekTarget(ex: CoachExercise, target: number, week: number): number {
  const c = COACH_CATALOG[ex];
  return Math.min(c.max, Math.round(target * (1 + 0.1 * (week - 1))));
}

/** Примерный расход, ккал: MET × вес × часы работы + отдых в покое. */
export function sessionKcal(s: PlanSession, weightKg: number, week = 1): number {
  let kcal = 0;
  for (const it of s.items) {
    const c = COACH_CATALOG[it.exercise];
    const active = it.sets * weekTarget(it.exercise, it.target, week) * c.secPerRep;
    kcal += (c.met * weightKg * active) / 3600;
    kcal += (1.5 * weightKg * Math.max(0, it.sets - 1) * it.restSec) / 3600;
  }
  return Math.max(5, Math.round(kcal / 5) * 5);
}

export function sessionLevel(s: PlanSession): 'Лёгкая' | 'Средняя' | 'Высокая' {
  const w = s.items.reduce((a, it) => a + it.sets, 0) || 1;
  const met = s.items.reduce((a, it) => a + COACH_CATALOG[it.exercise].met * it.sets, 0) / w;
  const volume = s.items.reduce((a, it) => a + it.sets, 0);
  const score = met + volume / 6;
  return score < 5.5 ? 'Лёгкая' : score < 8 ? 'Средняя' : 'Высокая';
}
