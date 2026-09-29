// Отведение ноги в сторону стоя (E-22): прямая нога уходит вбок, корпус вертикально.
//
// Угол отведения — между ногой (таз → щиколотка) и осью корпуса (плечи → таз) в плоскости кадра:
// анфас отведение лежит ровно в ней. Относительно оси корпуса, а не вертикали: наклон корпуса в другую
// сторону не выдаётся за отведение (его ловит отдельное правило). Каждое отведение — повтор, любой ногой.

import { ENGINE_CONFIG, type Widen } from '../config';
import { RAD_TO_DEG, pt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Side } from '../types';
import { LEG, OUTWARD, joint2, seen, sideTiltDeg, trunk } from './common';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type SideLegRaiseConfig = Widen<typeof ENGINE_CONFIG.exercises.side_leg_raise>;

export interface SideLegRaiseMetrics extends BaseMetrics {
  /** Отведение ноги наружу от оси корпуса, градусы (null — нога не видна). */
  abductL: number | null;
  abductR: number | null;
  side: Side;
  /** Наклон корпуса вбок, градусы. */
  tilt: number;
  /** Угол в колене по кадру, градусы (180 — прямая нога). */
  kneeL: number | null;
  kneeR: number | null;
}

class SideLegRaiseMeter implements ExerciseMeter<SideLegRaiseMetrics> {
  constructor(private readonly cfg: SideLegRaiseConfig) {}

  measure(frame: PoseFrame): SideLegRaiseMetrics | null {
    const t = trunk(frame);
    if (!t) return null;
    // Ось корпуса «вниз» и перпендикуляр к ней «вправо по картинке».
    const dx = t.hip.x - t.shoulder.x;
    const dy = t.hip.y - t.shoulder.y;
    const n = Math.hypot(dx, dy);
    if (!(n > 0) || dy <= 0) return null;
    const down = { x: dx / n, y: dy / n };
    const right = { x: down.y, y: -down.x };
    const abduct = (side: Side): number | null => {
      const { hip, ankle } = LEG[side];
      if (!seen(frame, hip) || !seen(frame, ankle)) return null;
      const lx = pt(frame, ankle).x - pt(frame, hip).x;
      const ly = pt(frame, ankle).y - pt(frame, hip).y;
      const lateral = lx * right.x + ly * right.y;
      const along = lx * down.x + ly * down.y;
      return Math.atan2(lateral * OUTWARD[side], along) * RAD_TO_DEG;
    };
    const abductL = abduct('left');
    const abductR = abduct('right');
    if (abductL === null && abductR === null) return null;
    const side: Side = (abductL ?? -Infinity) >= (abductR ?? -Infinity) ? 'left' : 'right';
    const best = Math.max(abductL ?? -Infinity, abductR ?? -Infinity);
    return {
      progress: (best - this.cfg.restDeg) / (this.cfg.goodDeg - this.cfg.restDeg),
      abductL,
      abductR,
      side,
      tilt: sideTiltDeg(t),
      kneeL: joint2(frame, LM.leftHip, LM.leftKnee, LM.leftAnkle),
      kneeR: joint2(frame, LM.rightHip, LM.rightKnee, LM.rightAnkle),
    };
  }

  reset(): void {}
}

export function sideLegRaiseRules(
  cfg: SideLegRaiseConfig = ENGINE_CONFIG.exercises.side_leg_raise,
): RuleDef<SideLegRaiseMetrics>[] {
  return [
    {
      code: 'leg_low',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) => {
        if (c.summary.pMax >= cfg.goodProgress) return null;
        const leg = LEG[c.atBottom.side];
        return { joints: [leg.knee, leg.ankle] };
      },
    },
    {
      code: 'torso_tilt',
      kind: 'frame',
      check: (m) => (Math.abs(m.tilt) > cfg.maxTiltDeg ? {} : null),
    },
    {
      code: 'knee_bent',
      kind: 'rep',
      on: ['rep'],
      check: (c) => {
        const m = c.atBottom;
        const knee = m.side === 'left' ? m.kneeL : m.kneeR;
        return knee !== null && knee < cfg.minKneeDeg ? { joints: [LEG[m.side].knee] } : null;
      },
    },
  ];
}

export function createSideLegRaise(
  cfg: SideLegRaiseConfig = ENGINE_CONFIG.exercises.side_leg_raise,
): ExerciseDef<SideLegRaiseMetrics> {
  return {
    id: 'side_leg_raise',
    requiredJoints: [LM.leftHip, LM.rightHip, LM.leftAnkle, LM.rightAnkle],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new SideLegRaiseMeter(cfg),
    rules: sideLegRaiseRules(cfg),
  };
}
