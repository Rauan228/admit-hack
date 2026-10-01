// Бокс: прямые удары (E-22). Стойка лицом к камере, кулаки у подбородка, удар — прямая рука вперёд, на камеру.
//
// Удар идёт вдоль оси камеры, в плоскости кадра его почти не видно: вынос кисти меряем по глубине —
// насколько кисть ближе к камере, чем плечо, в длинах корпуса. Мировые 3D-точки MediaPipe (или глубина z
// точек кадра, если 3D нет). В защите кисть впереди плеча на ~0,4 корпуса, прямая рука — на ~1,1.
// Каждый удар — повтор, любой рукой. Вторая рука во время удара — у подбородка (это видно в кадре, 2D).

import { ENGINE_CONFIG, type Widen } from '../config';
import { clamp, dist3, mid3, pt, torsoLength, wpt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Side } from '../types';
import { ARM, seen, trunk } from './common';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type BoxingConfig = Widen<typeof ENGINE_CONFIG.exercises.boxing>;

export interface BoxingMetrics extends BaseMetrics {
  /** Вынос кисти вперёд: 0 — защита, 1 — прямая рука (null — не видно). */
  punchL: number | null;
  punchR: number | null;
  /** Бьющая рука. */
  side: Side;
  /** Кисть ниже плеча, в длинах корпуса (+ — опущена; null — не видна). */
  dropL: number | null;
  dropR: number | null;
}

class BoxingMeter implements ExerciseMeter<BoxingMetrics> {
  constructor(private readonly cfg: BoxingConfig) {}

  measure(frame: PoseFrame): BoxingMetrics | null {
    const t = trunk(frame);
    const torso = torsoLength(frame);
    if (!t || !(torso > 0)) return null;
    // Глубина: мировые точки (метры) и корпус в метрах; без них — z точек кадра (в долях ширины, как x).
    const w = frame.world;
    const s3 = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip].map((i) => wpt(frame, i));
    const torso3 = w && s3.every(Boolean) ? dist3(mid3(s3[0]!, s3[1]!), mid3(s3[2]!, s3[3]!)) : null;
    const reach = (side: Side): number | null => {
      const { shoulder, wrist } = ARM[side];
      if (!seen(frame, wrist, 0.3, 0.15) || !seen(frame, shoulder)) return null;
      const ws = wpt(frame, wrist);
      const ss = wpt(frame, shoulder);
      const r =
        torso3 && ws && ss
          ? (ss.z - ws.z) / torso3
          : (((frame.image[shoulder]?.z ?? 0) - (frame.image[wrist]?.z ?? 0)) * frame.aspect) / torso;
      return clamp((r - this.cfg.guardReach) / (this.cfg.fullReach - this.cfg.guardReach), -0.5, 1.5);
    };
    const punchL = reach('left');
    const punchR = reach('right');
    if (punchL === null && punchR === null) return null;
    const side: Side = (punchL ?? -Infinity) >= (punchR ?? -Infinity) ? 'left' : 'right';
    const drop = (side: Side) =>
      seen(frame, ARM[side].wrist, 0.3, 0.15) ? (pt(frame, ARM[side].wrist).y - t.shoulder.y) / torso : null;
    return {
      progress: Math.max(punchL ?? -Infinity, punchR ?? -Infinity),
      punchL,
      punchR,
      side,
      dropL: drop('left'),
      dropR: drop('right'),
    };
  }

  reset(): void {}
}

export function boxingRules(cfg: BoxingConfig = ENGINE_CONFIG.exercises.boxing): RuleDef<BoxingMetrics>[] {
  return [
    {
      code: 'short_punch',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) => (c.summary.pMax < cfg.goodProgress ? { joints: [ARM[c.atBottom.side].elbow] } : null),
    },
    {
      code: 'guard_down',
      kind: 'frame',
      check: (m) => {
        // Вторая рука, пока бьёт первая, — у подбородка, не ниже плеча.
        if (m.progress < cfg.guardMinProgress) return null;
        const other: Side = m.side === 'left' ? 'right' : 'left';
        const drop = other === 'left' ? m.dropL : m.dropR;
        return drop !== null && drop > cfg.maxGuardDrop ? { joints: [ARM[other].wrist] } : null;
      },
    },
  ];
}

export function createBoxing(cfg: BoxingConfig = ENGINE_CONFIG.exercises.boxing): ExerciseDef<BoxingMetrics> {
  return {
    id: 'boxing',
    requiredJoints: [LM.leftShoulder, LM.rightShoulder, LM.leftWrist, LM.rightWrist],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new BoxingMeter(cfg),
    rules: boxingRules(cfg),
    // Бокс меряется по корпусу: ноги не нужны, но пояс в кадре быть должен (E-36, бой по пояс на телефоне боком).
    lostHint: 'Отойди чуть дальше — в кадре должны быть голова, плечи, руки и пояс',
  };
}
