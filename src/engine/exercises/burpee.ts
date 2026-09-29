// Бёрпи (E-22): из стойки — в упор лёжа, обратно и выпрыгнуть вверх. Лицом к камере (или боком).
//
// Прогресс — насколько опустились плечи к полу: высота плеч над полом относительно той же высоты стоя.
// Пол — самая низкая высота щиколоток за окно (в упоре стопы могут быть не видны — пол помним).
// В упоре лёжа плечи на высоте вытянутой руки: ~0,3 высоты стоя. Присед опускает плечи лишь на треть —
// это попытка с подсказкой «до упора лёжа», а не бёрпи. «Звёздочка» плечи почти не опускает — ничего.
// Встал после упора — ждём прыжок (стопы от пола или руки над головой) до jumpWaitMs, как в приседе с прыжком.

import { ENGINE_CONFIG, type Widen } from '../config';
import { pt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Phase } from '../types';
import { SlidingMax, SlidingQuantile } from './baseline';
import { REST_Q, seen, trunk } from './common';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type BurpeeConfig = Widen<typeof ENGINE_CONFIG.exercises.burpee>;

export interface BurpeeMetrics extends BaseMetrics {
  /** Насколько опустились плечи к полу: 0 — стоя, 1 — упор лёжа. */
  depth: number;
  /** Прыжок: щиколотки над полом в долях высоты плеч стоя (null — не видно). */
  rise: number | null;
  /** Кисти над носом (руки вверх в прыжке). */
  handsUp: boolean;
}

/**
 * Прыжок — только стоя: в упоре лёжа стопы на носках позади тела, и в кадре щиколотки «выше пола»
 * (на реальной записи 0,10–0,12) — это не прыжок.
 */
function jumped(m: BurpeeMetrics, cfg: { standMax: number; jumpMin: number }): boolean {
  return m.depth < cfg.standMax && ((m.rise ?? 0) >= cfg.jumpMin || m.handsUp);
}

class BurpeeMeter implements ExerciseMeter<BurpeeMetrics> {
  private readonly floor: SlidingMax;
  private readonly stand: SlidingQuantile;
  private down = false;
  private stoodAt: number | null = null;

  constructor(private readonly cfg: BurpeeConfig) {
    this.floor = new SlidingMax(cfg.baselineWindowMs);
    this.stand = new SlidingQuantile(cfg.baselineWindowMs, REST_Q);
  }

  measure(frame: PoseFrame, phase: Phase): BurpeeMetrics | null {
    const t = trunk(frame);
    if (!t) return null;
    const ankles = seen(frame, LM.leftAnkle) && seen(frame, LM.rightAnkle);
    const ankleY = ankles ? (pt(frame, LM.leftAnkle).y + pt(frame, LM.rightAnkle).y) / 2 : null;
    if (ankleY !== null) this.floor.push(ankleY, frame.t);
    const floor = this.floor.value;
    if (floor === null) return null;
    const height = floor - t.shoulder.y;
    // Высоту стоя обновляем, только пока человек стоит (иначе упор лёжа занижал бы эталон).
    if (phase === 'start') this.stand.push(height, frame.t);
    const stand = this.stand.value;
    if (!stand || !(stand > 0)) return null;
    const depth = (1 - height / stand) / (1 - this.cfg.floorRatio);
    const rise = ankleY === null ? null : (floor - ankleY) / stand;
    const nose = frame.image[LM.nose];
    const handsUp =
      !!nose &&
      nose.v >= 0.5 &&
      [LM.leftWrist, LM.rightWrist].every(
        (i) => seen(frame, i, 0.4, 0.15) && pt(frame, i).y < pt(frame, LM.nose).y,
      );
    const cfg = this.cfg;
    if (phase === 'start') {
      this.down = false;
      this.stoodAt = null;
    }
    if (depth >= cfg.floorMark) {
      this.down = true;
      this.stoodAt = null;
    }
    const m: BurpeeMetrics = { progress: depth, depth, rise, handsUp };
    if (jumped(m, cfg)) this.down = false;
    let pending = 0;
    if (this.down && depth < cfg.standMax) {
      this.stoodAt ??= frame.t;
      if (frame.t - this.stoodAt < cfg.jumpWaitMs) pending = cfg.pendingFloor;
      else this.down = false;
    }
    return { ...m, progress: Math.max(depth, pending) };
  }

  reset(): void {
    this.floor.reset();
    this.stand.reset();
    this.down = false;
    this.stoodAt = null;
  }
}

export function burpeeRules(cfg: BurpeeConfig = ENGINE_CONFIG.exercises.burpee): RuleDef<BurpeeMetrics>[] {
  return [
    {
      code: 'not_low',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) => (c.summary.pMax < cfg.goodProgress ? {} : null),
    },
    {
      code: 'no_jump',
      kind: 'rep',
      on: ['rep'],
      check: (c) => {
        return c.frames.some((m) => jumped(m, cfg)) ? null : { joints: [LM.leftAnkle, LM.rightAnkle] };
      },
    },
  ];
}

export function createBurpee(cfg: BurpeeConfig = ENGINE_CONFIG.exercises.burpee): ExerciseDef<BurpeeMetrics> {
  return {
    id: 'burpee',
    requiredJoints: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
    // Прыжок с руками над головой — часть бёрпи: жест «обе руки вверх» на подходе выключен.
    armsOverhead: true,
    fsm: cfg.fsm,
    createMeter: () => new BurpeeMeter(cfg),
    rules: burpeeRules(cfg),
  };
}
