// Боковой («казачий») выпад (E-22): широкая стойка, одна нога сгибается до параллели, другая прямая.
//
// Глубина — та же мера, что у приседа, но по каждой ноге отдельно: вертикаль бедра к вертикали голени
// относительно того же стоя. Прямая нога при этом остаётся «стоя» (бедро и голень укорачиваются в одной
// пропорции). Цель — не параллель, как в приседе (с прямой второй ногой до неё не сесть без шпагата),
// а сгиб колена ~90°: отношение targetRatio. Каждый выпад — повтор, любой ногой.

import { ENGINE_CONFIG, type Widen } from '../config';
import type { PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Phase, Side } from '../types';
import { LEG, joint2 } from './common';
import { createSquat, type SquatMetrics } from './squat';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type SideLungeConfig = Widen<typeof ENGINE_CONFIG.exercises.side_lunge>;

export interface SideLungeMetrics extends BaseMetrics {
  /** Глубина по каждой ноге: 0 — стоя, 1 — бедро параллельно полу (null — нога не видна). */
  depthL: number | null;
  depthR: number | null;
  /** Какая нога согнута. */
  side: Side;
  /** Угол в колене по кадру, градусы (180 — прямая нога). */
  kneeL: number | null;
  kneeR: number | null;
  /** Метрики приседа этого кадра: колени внутрь, наклон корпуса. */
  squat: SquatMetrics;
}

class SideLungeMeter implements ExerciseMeter<SideLungeMetrics> {
  private readonly squat = createSquat().createMeter();

  constructor(private readonly cfg: SideLungeConfig) {}

  measure(frame: PoseFrame, phase: Phase): SideLungeMetrics | null {
    const squat = this.squat.measure(frame, phase);
    if (!squat) return null;
    const depth = (ratio: number | null) =>
      ratio === null ? null : (1 - ratio) / (1 - this.cfg.targetRatio);
    const depthL = depth(squat.thighRatioL);
    const depthR = depth(squat.thighRatioR);
    const side: Side = (depthL ?? -Infinity) >= (depthR ?? -Infinity) ? 'left' : 'right';
    return {
      progress: Math.max(depthL ?? -Infinity, depthR ?? -Infinity),
      depthL,
      depthR,
      side,
      kneeL: joint2(frame, LM.leftHip, LM.leftKnee, LM.leftAnkle),
      kneeR: joint2(frame, LM.rightHip, LM.rightKnee, LM.rightAnkle),
      squat,
    };
  }

  reset(): void {
    this.squat.reset();
  }
}

export function sideLungeRules(
  cfg: SideLungeConfig = ENGINE_CONFIG.exercises.side_lunge,
): RuleDef<SideLungeMetrics>[] {
  return [
    {
      code: 'shallow_side',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) => {
        if (c.summary.pMax >= cfg.goodDepth) return null;
        const leg = LEG[c.atBottom.side];
        return { joints: [leg.hip, leg.knee] };
      },
    },
    {
      code: 'straight_leg_bent',
      kind: 'rep',
      on: ['rep'],
      check: (c) => {
        // Вторая нога в нижней точке должна быть прямой.
        const m = c.atBottom;
        const other: Side = m.side === 'left' ? 'right' : 'left';
        const knee = other === 'left' ? m.kneeL : m.kneeR;
        return knee !== null && knee < cfg.minStraightKneeDeg ? { joints: [LEG[other].knee] } : null;
      },
    },
    {
      code: 'knee_in',
      kind: 'frame',
      check: (m) => {
        if (m.progress < cfg.kneeMinProgress) return null;
        // Как «колени внутрь» у приседа: колено внутри линии таз → щиколотка. Не «колено над стопой»:
        // в широкой стойке колено и так стоит внутри стопы по x, нога идёт по диагонали.
        const inward = m.side === 'left' ? m.squat.kneeInL : m.squat.kneeInR;
        return inward !== null && inward > cfg.kneeInOffset ? { joints: [LEG[m.side].knee] } : null;
      },
    },
    {
      code: 'torso_lean',
      kind: 'frame',
      check: (m) => (m.squat.lean !== null && m.squat.lean > cfg.maxLeanDeg ? {} : null),
    },
  ];
}

export function createSideLunge(
  cfg: SideLungeConfig = ENGINE_CONFIG.exercises.side_lunge,
): ExerciseDef<SideLungeMetrics> {
  return {
    id: 'side_lunge',
    requiredJoints: [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new SideLungeMeter(cfg),
    rules: sideLungeRules(cfg),
  };
}
