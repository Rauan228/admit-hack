// Присед + руки вверх (E-22, трастер без веса): присел до параллели, встал и выжал руки над головой.
//
// Глубина — та же мера, что у приседа (1 — бедро параллельно полу): проверена на реальных записях с любого
// ракурса. Руки — от «кисти у плеч» (0) до «прямые над головой» (1). Прогресс — большее из двух, поэтому
// слитный подъём с выжимом остаётся одним движением. Встал после приседа и ещё не выжал — прогресс держится
// на pendingFloor до pressWaitMs: «присел → встал → выжал» с паузой — тоже один повтор, а не два.
// Только присед без жима и только жим без приседа — повтор с ошибкой: человек слышит, чего не хватило.

import { ENGINE_CONFIG, type Widen } from '../config';
import { angle2, angle3, clamp, isVisible, mid2, pt, torsoLength, wpt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { FrameRule, RuleDef } from '../rules';
import type { Phase } from '../types';
import { createSquat, squatRules, type SquatMetrics } from './squat';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type SquatPressConfig = Widen<typeof ENGINE_CONFIG.exercises.squat_press>;

const ARMS = {
  left: { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist },
  right: { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist },
} as const;

export interface SquatPressMetrics extends BaseMetrics {
  /** Глубина приседа: 0 — стоя, 1 — бедро параллельно полу (null — ноги не видны). */
  depth: number | null;
  /** Руки: 0 — кисти у плеч или ниже, 1 — прямые над головой (null — не видно). */
  press: number | null;
  /** Угол в локтях, градусы (180 — прямая рука). */
  elbowL: number | null;
  elbowR: number | null;
  /** Метрики приседа этого кадра — для правила «колени внутрь». */
  squat: SquatMetrics | null;
}

class SquatPressMeter implements ExerciseMeter<SquatPressMetrics> {
  private readonly squat = createSquat().createMeter();
  /** Присел — ждём жим. */
  private squatted = false;
  /** Когда встал после приседа (ждём жим не дольше pressWaitMs). */
  private stoodAt: number | null = null;

  constructor(private readonly cfg: SquatPressConfig) {}

  measure(frame: PoseFrame, phase: Phase): SquatPressMetrics | null {
    const squat = this.squat.measure(frame, phase);
    const arms = this.arms(frame);
    if (!squat && arms.press === null) return null;
    const depth = squat ? squat.progress : null;
    const cfg = this.cfg;

    // Память «присел → ждём жим» живёт внутри одного движения.
    if (phase === 'start') {
      this.squatted = false;
      this.stoodAt = null;
    }
    if ((depth ?? 0) >= cfg.squatMark) {
      this.squatted = true;
      this.stoodAt = null;
    }
    if ((arms.press ?? 0) >= cfg.pressMark) this.squatted = false;
    let floor = 0;
    if (this.squatted && (depth ?? 0) < cfg.standMax) {
      this.stoodAt ??= frame.t;
      if (frame.t - this.stoodAt < cfg.pressWaitMs) floor = cfg.pendingFloor;
      else this.squatted = false;
    }

    return {
      progress: Math.max(depth ?? 0, arms.press ?? 0, floor),
      depth,
      press: arms.press,
      elbowL: arms.elbowL,
      elbowR: arms.elbowR,
      squat,
    };
  }

  reset(): void {
    this.squat.reset();
    this.squatted = false;
    this.stoodAt = null;
  }

  private arms(frame: PoseFrame): Pick<SquatPressMetrics, 'press' | 'elbowL' | 'elbowR'> {
    const none = { press: null, elbowL: null, elbowR: null };
    if (![LM.leftShoulder, LM.rightShoulder].every((i) => isVisible(frame.image[i], 0.5, 0.05))) return none;
    const torso = torsoLength(frame);
    if (!(torso > 0)) return none;
    const shoulderY = mid2(pt(frame, LM.leftShoulder), pt(frame, LM.rightShoulder)).y;
    const cfg = this.cfg;
    const arm = (side: 'left' | 'right') => {
      const { shoulder, elbow, wrist } = ARMS[side];
      // Руки над головой часто выходят за верхний край кадра — даём запас.
      if (!isVisible(frame.image[wrist], 0.4, 0.15)) return { press: null, elbowDeg: null };
      // Высота руки — мера подъёма рук (0 — вдоль тела, 1 — над головой), от неё — доля пути «от плеч вверх».
      const lift = (shoulderY + cfg.armsDown * torso - pt(frame, wrist).y) / (cfg.armsSpan * torso);
      // Сверху не обрезаем сильно: по максимуму ищем верхнюю точку жима, где судим прямые ли руки.
      const press = clamp((lift - cfg.rackLift) / (1 - cfg.rackLift), 0, 3);
      const s3 = wpt(frame, shoulder);
      const e3 = wpt(frame, elbow);
      const w3 = wpt(frame, wrist);
      let elbowDeg = s3 && e3 && w3 ? angle3(s3, e3, w3) : NaN;
      if (!Number.isFinite(elbowDeg) && isVisible(frame.image[elbow], 0.4, 0.15)) {
        elbowDeg = angle2(pt(frame, shoulder), pt(frame, elbow), pt(frame, wrist));
      }
      return { press, elbowDeg: Number.isFinite(elbowDeg) ? elbowDeg : null };
    };
    const l = arm('left');
    const r = arm('right');
    const press = l.press !== null && r.press !== null ? (l.press + r.press) / 2 : (l.press ?? r.press);
    return { press, elbowL: l.elbowDeg, elbowR: r.elbowDeg };
  }
}

const maxOf = (frames: readonly SquatPressMetrics[], pick: (m: SquatPressMetrics) => number | null) =>
  Math.max(-Infinity, ...frames.map((m) => pick(m) ?? -Infinity));

export function squatPressRules(
  cfg: SquatPressConfig = ENGINE_CONFIG.exercises.squat_press,
): RuleDef<SquatPressMetrics>[] {
  const kneesIn = squatRules().find((r) => r.code === 'knees_in') as FrameRule<SquatMetrics>;
  return [
    {
      code: 'shallow_depth',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) => (maxOf(c.frames, (m) => m.depth) < cfg.goodDepth ? {} : null),
    },
    {
      code: 'press_low',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) => {
        // Руки ни разу не попали в кадр — судить не о чем.
        const top = maxOf(c.frames, (m) => m.press);
        if (top === -Infinity) return null;
        if (top < cfg.goodPress) return { joints: [LM.leftWrist, LM.rightWrist] };
        // Прямые ли руки — по самому прямому локтю, пока руки наверху, а не по одному кадру максимальной высоты:
        // 3D-угол дальнего от камеры локтя MediaPipe занижает (на прямых руках 138–145° в отдельных кадрах).
        const high = c.frames.filter((m) => (m.press ?? -Infinity) >= cfg.goodPress);
        const straightL = maxOf(high, (m) => m.elbowL);
        const straightR = maxOf(high, (m) => m.elbowR);
        const bentL = straightL !== -Infinity && straightL < cfg.minElbowDeg;
        const bentR = straightR !== -Infinity && straightR < cfg.minElbowDeg;
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
      // Колени внутрь — то же правило, что у приседа, по метрикам приседа этого кадра.
      code: 'knees_in',
      kind: 'frame',
      check: (m) => (m.squat ? kneesIn.check(m.squat) : null),
    },
  ];
}

export function createSquatPress(
  cfg: SquatPressConfig = ENGINE_CONFIG.exercises.squat_press,
): ExerciseDef<SquatPressMetrics> {
  return {
    id: 'squat_press',
    requiredJoints: [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
    // Руки над головой — часть упражнения: жест «обе руки вверх» на подходе выключен.
    armsOverhead: true,
    fsm: cfg.fsm,
    createMeter: () => new SquatPressMeter(cfg),
    rules: squatPressRules(cfg),
  };
}
