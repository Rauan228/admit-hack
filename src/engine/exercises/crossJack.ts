// «Звёздочка» с перекрёстом (E-22): прыжок — ноги шире плеч, руки в стороны на уровне плеч;
// прыжок обратно — руки скрещены перед грудью.
//
// Прогресс — «раскрытость»: среднее рук (от скрещенных до широко в стороны, и только на уровне плеч — руки,
// опущенные вдоль тела, раскрытыми не считаются) и ног (от «вместе» до шире плеч). Исходное положение —
// скрещенные руки или просто стоя. Меры — в ширинах плеч, не зависят от расстояния до камеры.

import { ENGINE_CONFIG, type Widen } from '../config';
import { clamp, pt, torsoLength, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import { maxOf, minOf, seen, trunk } from './common';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type CrossJackConfig = Widen<typeof ENGINE_CONFIG.exercises.cross_jack>;

export interface CrossJackMetrics extends BaseMetrics {
  t: number;
  /** Кисти: левая − правая по x, в ширинах плеч (минус — руки скрещены). */
  wristSep: number | null;
  /** Кисти ниже плеч, в длинах корпуса (null — не видны). */
  wristDrop: number | null;
  /** Стопы: левая − правая по x, в ширинах плеч. */
  stance: number | null;
}

class CrossJackMeter implements ExerciseMeter<CrossJackMetrics> {
  constructor(private readonly cfg: CrossJackConfig) {}

  measure(frame: PoseFrame): CrossJackMetrics | null {
    const t = trunk(frame);
    if (!t) return null;
    const cfg = this.cfg;
    const shoulderWidth = Math.abs(pt(frame, LM.leftShoulder).x - pt(frame, LM.rightShoulder).x);
    const torso = torsoLength(frame);
    if (!(shoulderWidth > 0) || !(torso > 0)) return null;

    let arms: number | null = null;
    let wristSep: number | null = null;
    let wristDrop: number | null = null;
    if (seen(frame, LM.leftWrist, 0.4, 0.15) && seen(frame, LM.rightWrist, 0.4, 0.15)) {
      wristSep = (pt(frame, LM.leftWrist).x - pt(frame, LM.rightWrist).x) / shoulderWidth;
      wristDrop = ((pt(frame, LM.leftWrist).y + pt(frame, LM.rightWrist).y) / 2 - t.shoulder.y) / torso;
      // Руки раскрыты, только если они на уровне плеч: опущенные вдоль тела — не «в стороны».
      const level = clamp(1 - (wristDrop - cfg.armsLevelDrop) / cfg.armsLevelFade, 0, 1);
      arms = clamp((wristSep - cfg.armsCrossed) / (cfg.armsOpen - cfg.armsCrossed), 0, 1.2) * level;
    }
    let legs: number | null = null;
    let stance: number | null = null;
    if (seen(frame, LM.leftAnkle) && seen(frame, LM.rightAnkle)) {
      stance = (pt(frame, LM.leftAnkle).x - pt(frame, LM.rightAnkle).x) / shoulderWidth;
      legs = clamp(stance / cfg.feetOpen, 0, 1.3);
    }
    if (arms === null && legs === null) return null;
    const progress = arms !== null && legs !== null ? (arms + legs) / 2 : ((arms ?? legs) as number);
    return { progress, t: frame.t, wristSep, wristDrop, stance };
  }

  reset(): void {}
}

export function crossJackRules(
  cfg: CrossJackConfig = ENGINE_CONFIG.exercises.cross_jack,
): RuleDef<CrossJackMetrics>[] {
  return [
    {
      code: 'no_cross',
      kind: 'rep',
      on: ['rep'],
      check: (c) => {
        // Скрещивание ищем в «закрытых» кадрах с руками на уровне груди — и в предыстории движения (там
        // скрещивание, с которого прыжок начался), и на возврате. Руки опущены вдоль тела (первый прыжок
        // из стойки) — судить не о чем.
        const closed = c.frames.filter(
          (m) =>
            m.progress < cfg.fsm.bottomMin / 2 &&
            m.wristDrop !== null &&
            m.wristDrop <= cfg.armsLevelDrop + cfg.armsLevelFade / 2,
        );
        const sep = minOf(closed, (m) => m.wristSep);
        if (sep === Infinity) return null;
        return sep > cfg.crossMax ? { joints: [LM.leftWrist, LM.rightWrist] } : null;
      },
    },
    {
      code: 'feet_narrow',
      kind: 'rep',
      on: ['rep'],
      check: (c) => {
        const stance = maxOf(c.frames, (m) => m.stance);
        return stance !== -Infinity && stance < cfg.feetMin ? {} : null;
      },
    },
    {
      code: 'arms_low',
      kind: 'rep',
      on: ['rep'],
      check: (c) => {
        // В раскрытом положении (самый широкий кадр) кисти должны быть на уровне плеч.
        const m = c.atBottom;
        return m.wristDrop !== null && m.wristDrop > cfg.maxOpenDrop ? {} : null;
      },
    },
  ];
}

export function createCrossJack(
  cfg: CrossJackConfig = ENGINE_CONFIG.exercises.cross_jack,
): ExerciseDef<CrossJackMetrics> {
  return {
    id: 'cross_jack',
    requiredJoints: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new CrossJackMeter(cfg),
    rules: crossJackRules(cfg),
  };
}
