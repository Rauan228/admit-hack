// ИИ-план на устройстве: анкета (чтобы не заполнять заново), последний план, выполненные дни и история тренировок.
// Вошедшему план ещё и хранит сервер (GET /api/coach/plan) — на новом устройстве подтягиваем оттуда.

import type { CoachPlan, CoachProfile } from '../../shared/coach';
import { weekTarget } from '../lib/coachPlan';
import type { Plan, PlanItem } from '../lib/exercises';

const KEY = {
  profile: 'forma.coach.profile.v1',
  plan: 'forma.coach.plan.v1',
  done: 'forma.coach.done.v2',
} as const;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* без хранилища план живёт до перезагрузки */
  }
}

export const loadCoachProfile = () => read<CoachProfile>(KEY.profile);
export const saveCoachProfile = (p: CoachProfile) => write(KEY.profile, p);
export const loadCoachPlan = () => read<CoachPlan>(KEY.plan);
export const saveCoachPlan = (plan: CoachPlan) => write(KEY.plan, plan);

/** Выход из аккаунта: план, анкета и история — этого человека, на устройстве их не оставляем (план хранит сервер). */
export function clearCoach(): void {
  try {
    for (const k of Object.values(KEY)) localStorage.removeItem(k);
  } catch {
    /* хранилище недоступно — нечего чистить */
  }
}

/** Одна пройденная тренировка плана. */
export interface CoachWorkout {
  at: number;
  week: number;
  index: number;
  reps: number;
  cleanReps: number;
  durationSec: number;
}

interface DoneStore {
  createdAt: number;
  history: CoachWorkout[];
}

/** История тренировок текущего плана (новый план — новая история). */
export function loadHistory(plan: CoachPlan): CoachWorkout[] {
  const d = read<DoneStore>(KEY.done);
  return d && d.createdAt === plan.createdAt && Array.isArray(d.history) ? d.history : [];
}

/** Выполнен ли день index на неделе week. */
export function isDone(history: readonly CoachWorkout[], week: number, index: number): boolean {
  return history.some((h) => h.week === week && h.index === index);
}

export function markDone(
  day: { createdAt: number; index: number; week: number },
  t: { reps: number; cleanReps: number; durationSec: number },
): void {
  const d = read<DoneStore>(KEY.done);
  const history = d && d.createdAt === day.createdAt ? d.history : [];
  write(KEY.done, {
    createdAt: day.createdAt,
    history: [
      ...history,
      {
        at: Date.now(),
        week: day.week,
        index: day.index,
        reps: t.reps,
        cleanReps: t.cleanReps,
        durationSec: t.durationSec,
      },
    ],
  });
}

/** День плана → обычная тренировка: подходы одного упражнения идут подряд, цели — под неделю программы. */
export function sessionPlan(plan: CoachPlan, index: number, week: number): Plan {
  const s = plan.sessions[index]!;
  const items: PlanItem[] = [];
  for (const it of s.items) {
    const target = weekTarget(it.exercise, it.target, week);
    for (let n = 1; n <= it.sets; n++)
      items.push({ exercise: it.exercise, target, set: { n, of: it.sets, restSec: it.restSec } });
  }
  return {
    kind: 'custom',
    label: `${s.day} · ${s.title}`,
    items,
    coachDay: { createdAt: plan.createdAt, index, week },
  };
}
