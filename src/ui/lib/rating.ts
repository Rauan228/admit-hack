// Результат тренировки → запись для рейтинга (доска режима + агрегаты) и подписи для UI.

import type { ExerciseId } from '../../engine/types';
import {
  BOARD_INFO,
  boardExercise,
  boardKind,
  rate,
  type Board,
  type ResultInput,
} from '../../shared/rating';
import { EXERCISE_META, type Plan } from './exercises';
import { totalsOf, type SetResult } from './results';

export function boardOf(plan: Plan): Board {
  if (plan.kind === 'single') return `single:${plan.items[0]!.exercise as ExerciseId}` as Board;
  return plan.kind;
}

export function resultInput(plan: Plan, results: SetResult[]): ResultInput {
  const t = totalsOf(results);
  const errorCounts: Record<string, number> = {};
  for (const r of results)
    for (const [code, n] of Object.entries(r.stats.errorCounts))
      errorCounts[code] = (errorCounts[code] ?? 0) + n;
  return {
    board: boardOf(plan),
    reps: t.reps,
    cleanReps: t.cleanReps,
    avgScore: t.avgScore,
    durationSec: t.durationSec,
    target: plan.items.reduce((a, i) => a + i.target, 0),
    errorCounts,
  };
}

/** Рейтинг этой тренировки (сервер посчитает так же). */
export function ratingOf(plan: Plan, results: SetResult[]): number {
  return rate(resultInput(plan, results)).rating;
}

export function boardTitle(board: Board): string {
  const ex = boardExercise(board);
  return ex ? EXERCISE_META[ex].title : BOARD_INFO[boardKind(board)].title;
}

export function boardUnit(board: Board): string {
  return BOARD_INFO[boardKind(board)].unit;
}
