// Подписи страницы дуэли: название упражнения, время боя, как ставить камеру, склонения.
// Общие для выбора, лобби, вызовов и итога — чтобы везде было одинаково.

import type { ExerciseId } from '../engine/types';
import { DEFAULT_DUEL_EXERCISE, isDuelExercise, type DuelExercise } from '../shared/duel';
import { CATEGORIES, EXERCISE_META } from '../ui/lib/exercises';

export function exerciseTitle(ex: ExerciseId): string {
  return EXERCISE_META[ex]?.title ?? ex;
}

/** Упражнение с сервера (старый ответ без поля — отжимания). */
export function duelExercise(x: unknown): DuelExercise {
  return isDuelExercise(x) ? x : DEFAULT_DUEL_EXERCISE;
}

/** На полу (отжимания) — телефон кладут перед собой; остальное — стоя в 2–3 м. */
export function isFloor(ex: ExerciseId): boolean {
  return !!EXERCISE_META[ex]?.setup;
}

export function whereLabel(ex: ExerciseId): string {
  return isFloor(ex) ? 'Телефон на полу' : 'Стоя, в 2–3 м';
}

/** Группа, как в каталоге платформы: «Ноги», «Кардио», «Руки и кор», «На полу». */
export function groupLabel(ex: ExerciseId): string {
  return CATEGORIES.find((c) => c.items.includes(ex))?.title ?? '';
}

/** Время боя по-человечески: «30 с», «1 мин», «3 мин». */
export function durationLabel(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)} с` : `${Math.round(ms / 60_000)} мин`;
}

/** Как ставить камеру: на полу перед собой (отжимания) или стоя лицом к ней. */
export function cameraTip(ex: ExerciseId): string {
  const floor = EXERCISE_META[ex]?.setup;
  return floor
    ? `${floor}: в кадре голова, плечи и кисти.`
    : 'Поставь телефон или ноутбук в 2–3 метрах и встань лицом к нему — в кадре должен быть ты целиком.';
}

export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

export function repsWord(n: number): string {
  return plural(n, 'повтор', 'повтора', 'повторов');
}
