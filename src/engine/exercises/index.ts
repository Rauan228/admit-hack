// Реестр упражнений: id из контракта → описание (измеритель, пороги, правила).

import type { ExerciseId } from '../types';
import { createJumpingJack } from './jumpingJack';
import { createLunge } from './lunge';
import { createSquat } from './squat';
import type { BaseMetrics, ExerciseDef } from './types';

const FACTORIES: Partial<Record<ExerciseId, () => ExerciseDef<BaseMetrics>>> = {
  squat: createSquat as () => ExerciseDef<BaseMetrics>,
  jumping_jack: createJumpingJack as () => ExerciseDef<BaseMetrics>,
  lunge: createLunge as () => ExerciseDef<BaseMetrics>,
};

/** Описание упражнения или null, если движок его пока не умеет. */
export function createExercise(id: ExerciseId): ExerciseDef<BaseMetrics> | null {
  return FACTORIES[id]?.() ?? null;
}
