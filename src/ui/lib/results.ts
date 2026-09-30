// Итоги подходов и тренировки. Обычно SetStats присылает движок (set_complete),
// но в челлендже по таймеру UI собирает их сам из событий rep.

import type { ExerciseId, SetStats } from '../../engine/types';
import { errorMessage } from './exercises';

export interface SetResult {
  exercise: ExerciseId;
  target: number;
  stats: SetStats;
}

export class SetAccumulator {
  private readonly startedAt = performance.now();
  private readonly perRep: number[] = [];
  private readonly errorCounts: Record<string, number> = {};
  private clean = 0;

  addRep(score: number, errors: string[]): void {
    this.perRep.push(score);
    if (errors.length === 0) this.clean += 1;
    for (const code of errors) this.errorCounts[code] = (this.errorCounts[code] ?? 0) + 1;
  }

  get reps(): number {
    return this.perRep.length;
  }

  stats(): SetStats {
    const reps = this.perRep.length;
    return {
      reps,
      cleanReps: this.clean,
      avgScore: reps ? Math.round(this.perRep.reduce((a, b) => a + b, 0) / reps) : 0,
      durationSec: Math.round((performance.now() - this.startedAt) / 100) / 10,
      errorCounts: { ...this.errorCounts },
      perRep: [...this.perRep],
    };
  }
}

export interface WorkoutTotals {
  reps: number;
  cleanReps: number;
  avgScore: number;
  cleanPct: number;
  durationSec: number;
  /** Очки = сумма оценок всех повторений: и количество, и качество. */
  points: number;
  perRep: { exercise: ExerciseId; score: number }[];
  topErrors: { exercise: ExerciseId; code: string; message: string; count: number }[];
}

export function totalsOf(results: SetResult[]): WorkoutTotals {
  const perRep = results.flatMap((r) => r.stats.perRep.map((score) => ({ exercise: r.exercise, score })));
  const reps = results.reduce((a, r) => a + r.stats.reps, 0);
  const cleanReps = results.reduce((a, r) => a + r.stats.cleanReps, 0);
  const points = perRep.reduce((a, r) => a + r.score, 0);
  const errors = results.flatMap((r) =>
    Object.entries(r.stats.errorCounts).map(([code, count]) => ({
      exercise: r.exercise,
      code,
      count,
      message: errorMessage(r.exercise, code),
    })),
  );
  errors.sort((a, b) => b.count - a.count);
  return {
    reps,
    cleanReps,
    avgScore: reps ? Math.round(points / reps) : 0,
    cleanPct: reps ? Math.round((cleanReps / reps) * 100) : 0,
    durationSec: Math.round(results.reduce((a, r) => a + r.stats.durationSec, 0)),
    points,
    perRep,
    topErrors: errors.slice(0, 3),
  };
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
