// Бокс: прямые удары (E-22). Стойка лицом к камере, кулаки у подбородка, удар — прямая рука вперёд, на камеру.
//
// Удар идёт вдоль оси камеры, в плоскости кадра его почти не видно. Главный сигнал — разгибание локтя
// по мировым 3D-точкам MediaPipe: в защите локоть согнут (~60–95°), прямой удар — 155–170°. Глубину
// (насколько кисть ближе к камере, чем плечо) анфас MediaPipe оценивает грубо: на записи прямого удара она
// доходила до 0,6 от нужного и шумела, а угол локтя шёл чисто 90° → 165°. Глубина — только если 3D нет.
// Разогнутая рука засчитывается, только когда кисть на уровне плеч: опущенная вдоль тела рука — не удар.
// Каждый удар — повтор, любой рукой. Вторая рука во время удара — у подбородка (это видно в кадре, 2D).

import { ENGINE_CONFIG, type Widen } from '../config';
import { angle3, clamp, dist2, mid2, pt, torsoLength, wpt, type PoseFrame } from '../geometry';
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
    // Бокс — упражнение для верха тела: стоят и близко к камере, по пояс. Бёдер не видно — длину корпуса
    // берём из ширины плеч (у взрослого корпус ≈ 1,4 ширины плеч).
    if (!seen(frame, LM.leftShoulder) || !seen(frame, LM.rightShoulder)) return null;
    const full = trunk(frame);
    const shoulder = mid2(pt(frame, LM.leftShoulder), pt(frame, LM.rightShoulder));
    const torso = full
      ? torsoLength(frame)
      : dist2(pt(frame, LM.leftShoulder), pt(frame, LM.rightShoulder)) * this.cfg.torsoPerShoulders;
    if (!(torso > 0)) return null;
    const t = { shoulder };
    const reach = (side: Side): number | null => {
      const { shoulder, elbow, wrist } = ARM[side];
      if (!seen(frame, wrist, 0.3, 0.15) || !seen(frame, shoulder)) return null;
      // Кисть не у плеч (опущена вдоль тела или поднята над головой) — это не удар.
      const dy = (pt(frame, wrist).y - t.shoulder.y) / torso;
      if (dy > this.cfg.maxPunchDrop || dy < -this.cfg.maxPunchRise) return 0;
      const ss = wpt(frame, shoulder);
      const es = wpt(frame, elbow);
      const ws = wpt(frame, wrist);
      if (ss && es && ws) {
        const a = angle3(ss, es, ws);
        return clamp((a - this.cfg.elbowGuard) / (this.cfg.elbowFull - this.cfg.elbowGuard), -0.5, 1.5);
      }
      // Без 3D — глубина точек кадра (z в долях ширины, как x).
      const r = (((frame.image[shoulder]?.z ?? 0) - (frame.image[wrist]?.z ?? 0)) * frame.aspect) / torso;
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
  };
}
