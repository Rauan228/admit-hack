// Бокс: прямые удары (E-22). Стойка лицом к камере, кулаки у подбородка, удар — прямая рука вперёд, на камеру.
//
// Удар идёт вдоль оси камеры, в плоскости кадра его почти не видно: вынос кисти меряем по глубине —
// насколько кисть ближе к камере, чем плечо, в длинах руки (плечо–локоть–кисть по мировым 3D-точкам
// MediaPipe; без них — глубина z точек кадра и длина руки как ширина плеч × 1,55). Прямая рука на камеру — 1,0.
//
// Уровень защиты у каждой руки свой и подстраивается: нижний квантиль выноса за последние секунды. В стойке
// вполоборота передняя рука и так вынесена на полруки, без этого её удары не отличить от стойки (E-36,
// записи боксёров). Повтор считается по бьющей руке: она выбирается в исходном положении и держится до
// конца повтора, иначе быстрая серия «раз-два» сливалась в один удар — пока одна рука возвращается, вторая
// уже летит. Таз не нужен: бой на телефоне боком снимается по грудь.

import { ENGINE_CONFIG, type Widen } from '../config';
import { clamp, dist3, pt, wpt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Phase, Side } from '../types';
import { SlidingQuantile } from './baseline';
import { ARM, seen } from './common';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type BoxingConfig = Widen<typeof ENGINE_CONFIG.exercises.boxing>;

export interface BoxingMetrics extends BaseMetrics {
  /** Вынос кисти вперёд: 0 — защита, 1 — прямая рука (null — не видно). */
  punchL: number | null;
  punchR: number | null;
  /** Бьющая рука. */
  side: Side;
  /** Кисть ниже плеча, в ширинах плеч (+ — опущена; null — не видна). */
  dropL: number | null;
  dropR: number | null;
}

class BoxingMeter implements ExerciseMeter<BoxingMetrics> {
  private readonly arm: Record<Side, SlidingQuantile>;
  private readonly guard: Record<Side, SlidingQuantile>;
  private active: Side = 'left';

  constructor(private readonly cfg: BoxingConfig) {
    this.arm = {
      left: new SlidingQuantile(cfg.armWindowMs, 0.5),
      right: new SlidingQuantile(cfg.armWindowMs, 0.5),
    };
    this.guard = {
      left: new SlidingQuantile(cfg.guardWindowMs, cfg.guardQuantile),
      right: new SlidingQuantile(cfg.guardWindowMs, cfg.guardQuantile),
    };
  }

  measure(frame: PoseFrame, phase: Phase): BoxingMetrics | null {
    if (!seen(frame, LM.leftShoulder) || !seen(frame, LM.rightShoulder)) return null;
    const ls = pt(frame, LM.leftShoulder);
    const rs = pt(frame, LM.rightShoulder);
    const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    if (!(shoulderW > 0)) return null;
    const punchL = this.reach(frame, 'left', shoulderW);
    const punchR = this.reach(frame, 'right', shoulderW);
    if (punchL === null && punchR === null) return null;
    // Бьющая рука: в исходном положении — та, что вынесена больше; в движении — не меняется.
    if (phase === 'start') this.active = (punchL ?? -Infinity) >= (punchR ?? -Infinity) ? 'left' : 'right';
    const own = this.active === 'left' ? punchL : punchR;
    const shoulderY = (ls.y + rs.y) / 2;
    const drop = (side: Side) =>
      seen(frame, ARM[side].wrist, 0.3, 0.15) ? (pt(frame, ARM[side].wrist).y - shoulderY) / shoulderW : null;
    return {
      progress: own ?? Math.max(punchL ?? -Infinity, punchR ?? -Infinity),
      punchL,
      punchR,
      side: this.active,
      dropL: drop('left'),
      dropR: drop('right'),
    };
  }

  /** Прогресс удара одной руки: вынос кисти в длинах руки относительно её уровня защиты. */
  private reach(frame: PoseFrame, side: Side, shoulderW: number): number | null {
    const { shoulder, elbow, wrist } = ARM[side];
    if (!seen(frame, wrist, 0.3, 0.15) || !seen(frame, shoulder)) return null;
    const s3 = wpt(frame, shoulder);
    const w3 = wpt(frame, wrist);
    const e3 = seen(frame, elbow, 0.3, 0.15) ? wpt(frame, elbow) : null;
    let forward: number;
    let arm: number;
    if (s3 && w3) {
      if (e3) this.arm[side].push(dist3(s3, e3) + dist3(e3, w3), frame.t);
      arm = this.arm[side].value ?? shoulderW3(frame) * this.cfg.armPerShoulder;
      forward = s3.z - w3.z;
    } else {
      // Без 3D-точек: глубина z точек кадра (в долях ширины, как x), длина руки — от ширины плеч.
      forward = ((frame.image[shoulder]?.z ?? 0) - (frame.image[wrist]?.z ?? 0)) * frame.aspect;
      arm = shoulderW * this.cfg.armPerShoulder;
    }
    if (!(arm > 0)) return null;
    const r = forward / arm;
    this.guard[side].push(r, frame.t);
    const g = Math.min(this.cfg.guardMax, this.guard[side].value ?? r);
    return clamp((r - g) / Math.max(0.25, this.cfg.fullReach - g), -0.5, 1.5);
  }

  reset(): void {
    for (const side of ['left', 'right'] as const) {
      this.arm[side].reset();
      this.guard[side].reset();
    }
    this.active = 'left';
  }
}

/** Ширина плеч в метрах по 3D-точкам (обе видны — measure это уже проверил). */
function shoulderW3(frame: PoseFrame): number {
  const l = wpt(frame, LM.leftShoulder);
  const r = wpt(frame, LM.rightShoulder);
  return l && r ? dist3(l, r) : 0;
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
    // Бокс меряется по плечам и рукам: таз и ноги не нужны (E-36, бой на телефоне боком — кадр по грудь).
    lostHint: 'Встань так, чтобы были видны голова, плечи и обе руки',
  };
}
