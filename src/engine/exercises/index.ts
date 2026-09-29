// Реестр упражнений: id из контракта → описание (измеритель, пороги, правила).

import type { ExerciseId } from '../types';
import { createArmRaise } from './armRaise';
import { createHighKnees } from './highKnees';
import { createJumpingJack } from './jumpingJack';
import { createKneeToElbow } from './kneeToElbow';
import { createLunge } from './lunge';
import { createSquat } from './squat';
import { createSquatPress } from './squatPress';
import type { BaseMetrics, ExerciseDef } from './types';

const FACTORIES: Partial<Record<ExerciseId, () => ExerciseDef<BaseMetrics>>> = {
  squat: createSquat as () => ExerciseDef<BaseMetrics>,
  jumping_jack: createJumpingJack as () => ExerciseDef<BaseMetrics>,
  lunge: createLunge as () => ExerciseDef<BaseMetrics>,
  arm_raise: createArmRaise as () => ExerciseDef<BaseMetrics>,
  high_knees: createHighKnees as () => ExerciseDef<BaseMetrics>,
  knee_to_elbow: createKneeToElbow as () => ExerciseDef<BaseMetrics>,
  squat_press: createSquatPress as () => ExerciseDef<BaseMetrics>,
};

/** Описание упражнения или null, если движок его пока не умеет. */
export function createExercise(id: ExerciseId): ExerciseDef<BaseMetrics> | null {
  return FACTORIES[id]?.() ?? null;
}
