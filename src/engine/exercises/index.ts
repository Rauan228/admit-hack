// Реестр упражнений: id из контракта → описание (измеритель, пороги, правила).

import type { ExerciseId } from '../types';
import { createArmCircles } from './armCircles';
import { createArmRaise } from './armRaise';
import { createBoxing } from './boxing';
import { createBurpee } from './burpee';
import { createCalfRaise } from './calfRaise';
import { createCrossJack } from './crossJack';
import { createPlank, createPushUp } from './floor';
import { createPullUp } from './pullUp';
import { createHighKnees } from './highKnees';
import { createJumpingJack } from './jumpingJack';
import { createJumpSquat } from './jumpSquat';
import { createKneeToElbow } from './kneeToElbow';
import { createLunge } from './lunge';
import { createSideBend } from './sideBend';
import { createSideLegRaise } from './sideLegRaise';
import { createSideLunge } from './sideLunge';
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
  arm_circles: createArmCircles as () => ExerciseDef<BaseMetrics>,
  calf_raise: createCalfRaise as () => ExerciseDef<BaseMetrics>,
  cross_jack: createCrossJack as () => ExerciseDef<BaseMetrics>,
  jump_squat: createJumpSquat as () => ExerciseDef<BaseMetrics>,
  side_bend: createSideBend as () => ExerciseDef<BaseMetrics>,
  side_leg_raise: createSideLegRaise as () => ExerciseDef<BaseMetrics>,
  side_lunge: createSideLunge as () => ExerciseDef<BaseMetrics>,
  boxing: createBoxing as () => ExerciseDef<BaseMetrics>,
  push_up: createPushUp as () => ExerciseDef<BaseMetrics>,
  plank: createPlank as () => ExerciseDef<BaseMetrics>,
  burpee: createBurpee as () => ExerciseDef<BaseMetrics>,
  pull_up: createPullUp as () => ExerciseDef<BaseMetrics>,
};

/** Описание упражнения или null, если движок его пока не умеет. */
export function createExercise(id: ExerciseId): ExerciseDef<BaseMetrics> | null {
  return FACTORIES[id]?.() ?? null;
}
