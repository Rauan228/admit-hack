// «Локоть к колену» стоя (E-22): руки за головой, колено поднимается, противоположный локоть тянется к нему.
//
// Прогресс — сближение локтя и противоположного колена по диагонали: (стоя − сейчас) / (стоя − touchGap),
// расстояние в длинах корпуса стоя, поэтому не зависит от расстояния до камеры. Берём ту диагональ, что
// сблизилась сильнее; между касаниями человек выпрямляется, и прогресс возвращается к нулю — каждое касание
// отдельный повтор. Локоть к колену своей стороны (боковой наклон) диагональ не сближает — это попытка.

import { ENGINE_CONFIG, type Widen } from '../config';
import { clamp, dist2, isVisible, pt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Side } from '../types';
import { SlidingQuantile } from './baseline';
import { KneeLift, maxLift } from './highKnees';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type KneeToElbowConfig = Widen<typeof ENGINE_CONFIG.exercises.knee_to_elbow>;

/** Диагональ: колено side и противоположный локоть. */
const DIAGONAL = {
  left: { knee: LM.leftKnee, elbow: LM.rightElbow },
  right: { knee: LM.rightKnee, elbow: LM.leftElbow },
} as const;

export interface KneeToElbowMetrics extends BaseMetrics {
  /** Колено, к которому тянется локоть (оно же поднимается). */
  side: Side | null;
  /** Сближение по диагонали к левому колену (правый локоть) и к правому (левый локоть): 0 — стоя, 1 — касание. */
  reachL: number | null;
  reachR: number | null;
  /** Подъём колен, как в «высоких коленях»: 0 — нога стоит, 1 — колено на уровне таза. */
  liftL: number | null;
  liftR: number | null;
}

class KneeToElbowMeter implements ExerciseMeter<KneeToElbowMetrics> {
  private readonly knees: KneeLift;
  private readonly rest: Record<Side, SlidingQuantile>;

  constructor(private readonly cfg: KneeToElbowConfig) {
    this.knees = new KneeLift(cfg.baselineWindowMs);
    // Стоя диагональ самая длинная: эталон — верхний квантиль окна (выброс модели его не раздует).
    this.rest = {
      left: new SlidingQuantile(cfg.baselineWindowMs, 0.9),
      right: new SlidingQuantile(cfg.baselineWindowMs, 0.9),
    };
  }

  measure(frame: PoseFrame): KneeToElbowMetrics | null {
    const { liftL, liftR, torso } = this.knees.measure(frame);
    if (!torso) return null;
    const reach = (side: Side): number | null => {
      const { knee, elbow } = DIAGONAL[side];
      if (!isVisible(frame.image[knee], 0.5, 0.05) || !isVisible(frame.image[elbow], 0.4, 0.1)) return null;
      const gap = dist2(pt(frame, knee), pt(frame, elbow)) / torso;
      this.rest[side].push(gap, frame.t);
      const rest = this.rest[side].value;
      if (!rest || rest <= this.cfg.touchGap) return null;
      return clamp((rest - gap) / (rest - this.cfg.touchGap), -0.5, 1.5);
    };
    const reachL = reach('left');
    const reachR = reach('right');
    if (reachL === null && reachR === null) return null;
    const side: Side = (reachL ?? -Infinity) >= (reachR ?? -Infinity) ? 'left' : 'right';
    const progress = Math.max(reachL ?? -Infinity, reachR ?? -Infinity);
    return { progress, side, reachL, reachR, liftL, liftR };
  }

  reset(): void {
    this.knees.reset();
    this.rest.left.reset();
    this.rest.right.reset();
  }
}

export function kneeToElbowRules(
  cfg: KneeToElbowConfig = ENGINE_CONFIG.exercises.knee_to_elbow,
): RuleDef<KneeToElbowMetrics>[] {
  return [
    {
      code: 'elbow_far',
      kind: 'rep',
      // По итогу движения: и повтор без касания, и попытка, которая повтором не стала.
      on: ['rep', 'attempt'],
      check: (c) => {
        if (c.summary.pMax >= cfg.goodProgress) return null;
        const side = c.atBottom.side;
        return side ? { joints: [DIAGONAL[side].elbow, DIAGONAL[side].knee] } : {};
      },
    },
    {
      code: 'knee_low',
      kind: 'rep',
      // Локоть дошёл, а колено нет — человек нагнулся к колену вместо того, чтобы поднять его.
      on: ['rep'],
      check: (c) => {
        const side = c.atBottom.side;
        if (!side || maxLift(c.frames, side) >= cfg.minKneeLift) return null;
        return { joints: [DIAGONAL[side].knee] };
      },
    },
  ];
}

export function createKneeToElbow(
  cfg: KneeToElbowConfig = ENGINE_CONFIG.exercises.knee_to_elbow,
): ExerciseDef<KneeToElbowMetrics> {
  return {
    id: 'knee_to_elbow',
    requiredJoints: [LM.leftElbow, LM.rightElbow, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee],
    // Руки за головой — кисти у макушки: жест «обе руки вверх» на подходе выключен, иначе он заканчивал бы подход.
    armsOverhead: true,
    fsm: cfg.fsm,
    createMeter: () => new KneeToElbowMeter(cfg),
    rules: kneeToElbowRules(cfg),
  };
}
