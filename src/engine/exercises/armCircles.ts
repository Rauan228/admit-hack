// Круги руками (E-22): прямые руки в стороны на уровне плеч, кисти описывают круги.
//
// Для каждой руки — центр круга (середина рамки, которую кисть обвела за последние windowMs) и угол кисти
// вокруг него от «верха». Прогресс (1 − cos угла) / 2: 0 наверху круга, 1 внизу — каждый оборот
// даёт один цикл 0 → 1 → 0 и один повтор, в какую бы сторону ни крутили. Кисть почти не двигается
// (радиус меньше minRadius) — прогресс 0: шум модели не превращается в «круги».

import { ENGINE_CONFIG, type Widen } from '../config';
import { pt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Side } from '../types';
import { ARM, OUTWARD, TorsoRef, joint2, maxOf, seen, trunk } from './common';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type ArmCirclesConfig = Widen<typeof ENGINE_CONFIG.exercises.arm_circles>;

export interface ArmCirclesMetrics extends BaseMetrics {
  /** Радиус круга кисти, в длинах корпуса (null — рука не видна). */
  radius: number | null;
  /** Центр кругов ниже плеч, в длинах корпуса. */
  drop: number | null;
  elbowL: number | null;
  elbowR: number | null;
}

class ArmCirclesMeter implements ExerciseMeter<ArmCirclesMetrics> {
  private readonly torso: TorsoRef;
  private readonly track: Record<Side, { t: number; x: number; y: number }[]> = { left: [], right: [] };

  constructor(private readonly cfg: ArmCirclesConfig) {
    this.torso = new TorsoRef(cfg.baselineWindowMs);
  }

  measure(frame: PoseFrame): ArmCirclesMetrics | null {
    const tr = trunk(frame);
    const torso = this.torso.update(frame);
    if (!tr || !torso) return null;
    const arm = (side: Side) => {
      const { wrist } = ARM[side];
      if (!seen(frame, wrist, 0.4, 0.15)) {
        this.track[side] = [];
        return null;
      }
      const w = pt(frame, wrist);
      const track = this.track[side];
      track.push({ t: frame.t, x: w.x, y: w.y });
      while (track.length > 0 && (track[0] as { t: number }).t < frame.t - this.cfg.windowMs) track.shift();
      const xs = track.map((p) => p.x);
      const ys = track.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const dx = (w.x - cx) * OUTWARD[side];
      const dy = w.y - cy;
      const radius =
        Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 / torso;
      // Кисть у самого центра (круги кончились, рамка ещё помнит старые) — угол не определён: прогресс 0.
      const off = Math.hypot(dx, dy) / torso;
      const p =
        radius >= this.cfg.minRadius && off >= radius / 2 ? (1 - Math.cos(Math.atan2(dx, -dy))) / 2 : 0;
      return { p, radius, drop: (cy - tr.shoulder.y) / torso };
    };
    const l = arm('left');
    const r = arm('right');
    if (!l && !r) return null;
    const arms = [l, r].filter((a): a is NonNullable<typeof l> => a !== null);
    const mean = (pick: (a: (typeof arms)[number]) => number) =>
      arms.reduce((s, a) => s + pick(a), 0) / arms.length;
    const drop = mean((a) => a.drop);
    // Руки опущены — это не круги на уровне плеч: прогресс 0 (подсказка «руки на уровень плеч» — правилом).
    const progress = drop > this.cfg.maxDrop ? 0 : mean((a) => a.p);
    return {
      progress,
      radius: mean((a) => a.radius),
      drop,
      elbowL: joint2(frame, LM.leftShoulder, LM.leftElbow, LM.leftWrist, 0.4),
      elbowR: joint2(frame, LM.rightShoulder, LM.rightElbow, LM.rightWrist, 0.4),
    };
  }

  reset(): void {
    this.torso.reset();
    this.track.left = [];
    this.track.right = [];
  }
}

export function armCirclesRules(
  cfg: ArmCirclesConfig = ENGINE_CONFIG.exercises.arm_circles,
): RuleDef<ArmCirclesMetrics>[] {
  return [
    {
      code: 'arms_low',
      kind: 'frame',
      check: (m) => (m.drop !== null && m.drop > cfg.maxDrop ? {} : null),
    },
    {
      code: 'elbows_bent',
      kind: 'frame',
      holdMs: 400,
      check: (m) => {
        const bentL = m.elbowL !== null && m.elbowL < cfg.minElbowDeg;
        const bentR = m.elbowR !== null && m.elbowR < cfg.minElbowDeg;
        if (!bentL && !bentR) return null;
        return {
          joints:
            bentL && !bentR
              ? [LM.leftElbow]
              : bentR && !bentL
                ? [LM.rightElbow]
                : [LM.leftElbow, LM.rightElbow],
        };
      },
    },
    {
      code: 'small_circles',
      kind: 'rep',
      on: ['rep'],
      check: (c) => (maxOf(c.frames, (m) => m.radius) < cfg.goodRadius ? {} : null),
    },
  ];
}

export function createArmCircles(
  cfg: ArmCirclesConfig = ENGINE_CONFIG.exercises.arm_circles,
): ExerciseDef<ArmCirclesMetrics> {
  return {
    id: 'arm_circles',
    requiredJoints: [LM.leftShoulder, LM.rightShoulder, LM.leftWrist, LM.rightWrist],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new ArmCirclesMeter(cfg),
    rules: armCirclesRules(cfg),
  };
}
