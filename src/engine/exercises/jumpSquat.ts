// Присед с выпрыгиванием (E-22): присел до параллели и выпрыгнул — стопы отрываются от пола.
//
// Глубина — мера приседа. Прыжок — щиколотки выше пола (скользящий максимум их высоты в кадре) в длинах
// корпуса стоя. Встал после приседа и ещё не прыгнул — прогресс держится на pendingFloor до jumpWaitMs,
// как в «присед + руки вверх»: движение закрывается прыжком, а если прыжка не было — через паузу, с ошибкой.

import { ENGINE_CONFIG, type Widen } from '../config';
import { pt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { FrameRule, RuleDef } from '../rules';
import type { Phase } from '../types';
import { SlidingMax } from './baseline';
import { TorsoRef, maxOf, seen } from './common';
import { createSquat, squatRules, type SquatMetrics } from './squat';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type JumpSquatConfig = Widen<typeof ENGINE_CONFIG.exercises.jump_squat>;

export interface JumpSquatMetrics extends BaseMetrics {
  /** Глубина приседа: 0 — стоя, 1 — бедро параллельно полу (null — ноги не видны). */
  depth: number | null;
  /** Отрыв щиколоток от пола, в длинах корпуса (null — не видно). */
  rise: number | null;
  squat: SquatMetrics | null;
}

class JumpSquatMeter implements ExerciseMeter<JumpSquatMetrics> {
  private readonly squat = createSquat().createMeter();
  private readonly torso: TorsoRef;
  /** Пол: самая низкая высота щиколоток за окно. */
  private readonly floor: SlidingMax;
  private squatted = false;
  private stoodAt: number | null = null;

  constructor(private readonly cfg: JumpSquatConfig) {
    this.torso = new TorsoRef(cfg.baselineWindowMs);
    this.floor = new SlidingMax(cfg.baselineWindowMs);
  }

  measure(frame: PoseFrame, phase: Phase): JumpSquatMetrics | null {
    const squat = this.squat.measure(frame, phase);
    const torso = this.torso.update(frame);
    let rise: number | null = null;
    if (torso && seen(frame, LM.leftAnkle) && seen(frame, LM.rightAnkle)) {
      const ankleY = (pt(frame, LM.leftAnkle).y + pt(frame, LM.rightAnkle).y) / 2;
      this.floor.push(ankleY, frame.t);
      const floor = this.floor.value;
      if (floor !== null) rise = (floor - ankleY) / torso;
    }
    if (!squat && rise === null) return null;
    const depth = squat ? squat.progress : null;
    const cfg = this.cfg;

    if (phase === 'start') {
      this.squatted = false;
      this.stoodAt = null;
    }
    if ((depth ?? 0) >= cfg.squatMark) {
      this.squatted = true;
      this.stoodAt = null;
    }
    if ((rise ?? 0) >= cfg.jumpMin) this.squatted = false;
    let floorP = 0;
    // Простоял всё ожидание и не прыгнул — повтор закончен (без прыжка): закрываем сейчас, иначе следующий
    // присед сразу после этого склеивался с ним (счётчик не успевал увидеть «стоит»).
    let returned = false;
    if (this.squatted && (depth ?? 0) < cfg.standMax) {
      this.stoodAt ??= frame.t;
      if (frame.t - this.stoodAt < cfg.jumpWaitMs) floorP = cfg.pendingFloor;
      else {
        this.squatted = false;
        this.stoodAt = null;
        returned = true;
      }
    }
    return { progress: Math.max(depth ?? 0, floorP), depth, rise, squat, returned };
  }

  reset(): void {
    this.squat.reset();
    this.torso.reset();
    this.floor.reset();
    this.squatted = false;
    this.stoodAt = null;
  }
}

export function jumpSquatRules(
  cfg: JumpSquatConfig = ENGINE_CONFIG.exercises.jump_squat,
): RuleDef<JumpSquatMetrics>[] {
  const kneesIn = squatRules().find((r) => r.code === 'knees_in') as FrameRule<SquatMetrics>;
  return [
    {
      code: 'shallow_depth',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) => (maxOf(c.frames, (m) => m.depth) < cfg.goodDepth ? {} : null),
    },
    {
      code: 'no_jump',
      kind: 'rep',
      on: ['rep'],
      check: (c) => {
        const rise = maxOf(c.frames, (m) => m.rise);
        // Стопы ни разу не были видны — судить не о чем.
        if (rise === -Infinity) return null;
        return rise < cfg.jumpMin ? { joints: [LM.leftAnkle, LM.rightAnkle] } : null;
      },
    },
    {
      code: 'knees_in',
      kind: 'frame',
      check: (m) => (m.squat ? kneesIn.check(m.squat) : null),
    },
  ];
}

export function createJumpSquat(
  cfg: JumpSquatConfig = ENGINE_CONFIG.exercises.jump_squat,
): ExerciseDef<JumpSquatMetrics> {
  return {
    id: 'jump_squat',
    requiredJoints: [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new JumpSquatMeter(cfg),
    rules: jumpSquatRules(cfg),
  };
}
