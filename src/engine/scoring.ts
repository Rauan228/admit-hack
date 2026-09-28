// Оценка повторения и итоги подхода (E-13).
//
// Оценка — 100 минус штраф за каждую ошибку повтора (штрафы — в каталоге hints.ts), но не ниже
// minScore: повтор с ошибками всё равно сделан. Никакой случайности: жюри и пользователь должны
// видеть, из чего сложилась цифра («−30: мало глубины»).

import { ENGINE_CONFIG, type Widen } from './config';
import type { FormErrorDef } from './hints';
import type { ExerciseId, SetStats } from './types';

type ScoringConfig = Widen<typeof ENGINE_CONFIG.scoring>;

/** Оценка повтора 0..100 по списку кодов ошибок. Повтор одной ошибки в списке штрафуется один раз. */
export function scoreRep(
  errors: readonly string[],
  catalog: readonly FormErrorDef[],
  cfg: ScoringConfig = ENGINE_CONFIG.scoring,
): number {
  let score = 100;
  for (const code of new Set(errors)) score -= catalog.find((e) => e.code === code)?.penalty ?? 0;
  return Math.max(cfg.minScore, Math.min(100, Math.round(score)));
}

/** Накопитель подхода: повторы → SetStats для события set_complete. */
export class SetTracker {
  private readonly perRep: number[] = [];
  private readonly errorCounts: Record<string, number> = {};
  private clean = 0;
  private firstMoveAt: number | null = null;
  private lastRepAt: number | null = null;

  constructor(
    readonly exercise: ExerciseId,
    private readonly catalog: readonly FormErrorDef[],
    private readonly cfg: ScoringConfig = ENGINE_CONFIG.scoring,
  ) {}

  get reps(): number {
    return this.perRep.length;
  }

  /** Человек начал первое движение подхода: отсюда считается длительность (без обратного отсчёта UI). */
  markMovement(tMs: number): void {
    this.firstMoveAt ??= tMs;
  }

  /** Засчитанный повтор; возвращает его оценку. */
  addRep(errors: readonly string[], startT: number, endT: number): number {
    this.markMovement(startT);
    this.lastRepAt = endT;
    const score = scoreRep(errors, this.catalog, this.cfg);
    this.perRep.push(score);
    const unique = new Set(errors);
    if (unique.size === 0) this.clean += 1;
    for (const code of unique) this.errorCounts[code] = (this.errorCounts[code] ?? 0) + 1;
    return score;
  }

  stats(): SetStats {
    const reps = this.perRep.length;
    const sum = this.perRep.reduce((a, b) => a + b, 0);
    const durationMs =
      this.firstMoveAt !== null && this.lastRepAt !== null
        ? Math.max(0, this.lastRepAt - this.firstMoveAt)
        : 0;
    return {
      reps,
      cleanReps: this.clean,
      avgScore: reps ? Math.round(sum / reps) : 0,
      durationSec: Math.round(durationMs / 100) / 10,
      errorCounts: { ...this.errorCounts },
      perRep: [...this.perRep],
    };
  }
}
