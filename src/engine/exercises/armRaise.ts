// Подъём рук через стороны над головой (E-20): запястья выше плеч, локти прямые, руки вместе.
//
// Прогресс — высота рук, та же мера, что у рук в «звёздочке»: от «вдоль тела» (0) до «над головой» (1)
// в длинах корпуса от плеча. Ошибки: локти согнуты в верхней точке, одна рука ниже другой.

import { ENGINE_CONFIG, type Widen } from '../config';
import { angle2, angle3, clamp, isVisible, mid2, pt, torsoLength, wpt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Joint } from '../types';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type ArmRaiseConfig = Widen<typeof ENGINE_CONFIG.exercises.arm_raise>;

const ARMS = {
  left: { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist },
  right: { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist },
} as const;

export interface ArmRaiseMetrics extends BaseMetrics {
  /** Высота каждой руки: 0 — вдоль тела, 1 — над головой (null — не видно). */
  armL: number | null;
  armR: number | null;
  /** Угол в локте, градусы (180 — прямая рука). */
  elbowL: number | null;
  elbowR: number | null;
}

class ArmRaiseMeter implements ExerciseMeter<ArmRaiseMetrics> {
  constructor(private readonly cfg: ArmRaiseConfig) {}

  measure(frame: PoseFrame): ArmRaiseMetrics | null {
    const shoulders = [LM.leftShoulder, LM.rightShoulder];
    if (!shoulders.every((i) => isVisible(frame.image[i], 0.5, 0.05))) return null;
    const torso = torsoLength(frame);
    if (!(torso > 0)) return null;
    const shoulderY = mid2(pt(frame, LM.leftShoulder), pt(frame, LM.rightShoulder)).y;

    const arm = (side: 'left' | 'right') => {
      const { shoulder, elbow, wrist } = ARMS[side];
      // Руки над головой часто выходят за верхний край кадра — даём запас.
      if (!isVisible(frame.image[wrist], 0.4, 0.15)) return { lift: null, elbowDeg: null };
      const lift = clamp(
        (shoulderY + this.cfg.armsDown * torso - pt(frame, wrist).y) / (this.cfg.armsSpan * torso),
        -0.3,
        1.4,
      );
      // Угол в локте: по 3D-точкам (не зависит от того, вперёд или в стороны подняты руки), иначе 2D.
      const s3 = wpt(frame, shoulder);
      const e3 = wpt(frame, elbow);
      const w3 = wpt(frame, wrist);
      let elbowDeg = s3 && e3 && w3 ? angle3(s3, e3, w3) : NaN;
      if (!Number.isFinite(elbowDeg) && isVisible(frame.image[elbow], 0.4, 0.15)) {
        elbowDeg = angle2(pt(frame, shoulder), pt(frame, elbow), pt(frame, wrist));
      }
      return { lift, elbowDeg: Number.isFinite(elbowDeg) ? elbowDeg : null };
    };
    const l = arm('left');
    const r = arm('right');
    if (l.lift === null && r.lift === null) return null;
    const progress =
      l.lift !== null && r.lift !== null ? (l.lift + r.lift) / 2 : ((l.lift ?? r.lift) as number);
    return { progress, armL: l.lift, armR: r.lift, elbowL: l.elbowDeg, elbowR: r.elbowDeg };
  }

  reset(): void {}
}

export function armRaiseRules(
  cfg: ArmRaiseConfig = ENGINE_CONFIG.exercises.arm_raise,
): RuleDef<ArmRaiseMetrics>[] {
  return [
    {
      code: 'elbows_bent',
      kind: 'rep',
      on: ['rep'],
      check: (c) => {
        // Судим в верхней точке повтора: там рука должна быть прямой.
        const m = c.atBottom;
        const bentL = m.elbowL !== null && m.elbowL < cfg.minElbowDeg;
        const bentR = m.elbowR !== null && m.elbowR < cfg.minElbowDeg;
        if (!bentL && !bentR) return null;
        const joints: Joint[] =
          bentL && !bentR
            ? [LM.leftElbow]
            : bentR && !bentL
              ? [LM.rightElbow]
              : [LM.leftElbow, LM.rightElbow];
        return { joints };
      },
    },
    {
      code: 'one_arm_low',
      kind: 'frame',
      check: (m) => {
        if (m.armL === null || m.armR === null || Math.abs(m.armL - m.armR) <= cfg.armGap) return null;
        return { joints: [m.armL < m.armR ? LM.leftWrist : LM.rightWrist] };
      },
    },
  ];
}

export function createArmRaise(
  cfg: ArmRaiseConfig = ENGINE_CONFIG.exercises.arm_raise,
): ExerciseDef<ArmRaiseMetrics> {
  return {
    id: 'arm_raise',
    requiredJoints: [LM.leftShoulder, LM.rightShoulder, LM.leftWrist, LM.rightWrist],
    // Руки над головой — само упражнение: жест «обе руки вверх» на подходе выключен.
    armsOverhead: true,
    fsm: cfg.fsm,
    createMeter: () => new ArmRaiseMeter(cfg),
    rules: armRaiseRules(cfg),
  };
}
