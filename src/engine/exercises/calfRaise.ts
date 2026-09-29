// Подъём на носки (E-22): пятки вверх, носки на полу, медленно.
//
// Подъём меряем относительно носков, а не пола в кадре: пятка и щиколотка поднимаются над носком, который
// стоит на месте. Так шаг от камеры (весь человек в кадре уезжает вверх) не выглядит подъёмом на носки.
// В длинах корпуса стоя; эталон «стоя» — нижний квантиль за окно (пятки на полу — минимум).

import { ENGINE_CONFIG, type Widen } from '../config';
import { pt, torsoLength, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Side } from '../types';
import { SlidingQuantile } from './baseline';
import { LEG, TorsoRef, seen, trunk } from './common';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type CalfRaiseConfig = Widen<typeof ENGINE_CONFIG.exercises.calf_raise>;

/** Плечи выше таза хотя бы на столько длин корпуса, щиколотки ниже таза хотя бы на столько — человек стоит. */
const UPRIGHT = 0.7;
const LEGS_BELOW = 1;

export interface CalfRaiseMetrics extends BaseMetrics {
  /** Пятки и щиколотки над носками, в длинах корпуса (без эталона стоя). */
  lift: number;
}

class CalfRaiseMeter implements ExerciseMeter<CalfRaiseMetrics> {
  private readonly torso: TorsoRef;
  private readonly rest: SlidingQuantile;
  private smooth: { t: number; v: number } | null = null;

  constructor(private readonly cfg: CalfRaiseConfig) {
    this.torso = new TorsoRef(cfg.baselineWindowMs);
    this.rest = new SlidingQuantile(cfg.baselineWindowMs, 0.1);
  }

  measure(frame: PoseFrame): CalfRaiseMetrics | null {
    // Сигнал в миллиметрах — меряем только правдоподобного стоящего человека: плечи над тазом, стопы под ним.
    const t = trunk(frame);
    if (!t) return null;
    const now = torsoLength(frame);
    if (!(now > 0) || t.hip.y - t.shoulder.y < UPRIGHT * now) return null;
    const ankles = [LM.leftAnkle, LM.rightAnkle].filter((i) => seen(frame, i));
    if (ankles.some((i) => pt(frame, i).y - t.hip.y < LEGS_BELOW * now)) return null;
    const torso = this.torso.update(frame);
    if (!torso) return null;
    const over = (side: Side): number | null => {
      const { ankle, heel, toe } = LEG[side];
      if (!seen(frame, ankle) || !seen(frame, toe, 0.4, 0.1)) return null;
      const toeY = pt(frame, toe).y;
      const ankleUp = toeY - pt(frame, ankle).y;
      // Пятка поднимается сильнее щиколотки; не видна — берём одну щиколотку.
      const heelUp = seen(frame, heel, 0.4, 0.1) ? toeY - pt(frame, heel).y : ankleUp;
      return (ankleUp + heelUp) / 2 / torso;
    };
    const l = over('left');
    const r = over('right');
    if (l === null && r === null) return null;
    const raw = l !== null && r !== null ? (l + r) / 2 : ((l ?? r) as number);
    // Одно-полюсный фильтр с постоянной времени smoothMs (по реальному времени, одинаково на 15 и 30 FPS).
    const prev = this.smooth;
    const k = prev ? 1 - Math.exp(-Math.max(0, frame.t - prev.t) / this.cfg.smoothMs) : 1;
    const lift = prev ? prev.v + (raw - prev.v) * k : raw;
    this.smooth = { t: frame.t, v: lift };
    this.rest.push(lift, frame.t);
    const rest = this.rest.value ?? lift;
    return { progress: (lift - rest) / this.cfg.goodRise, lift };
  }

  reset(): void {
    this.torso.reset();
    this.rest.reset();
    this.smooth = null;
  }
}

export function calfRaiseRules(
  cfg: CalfRaiseConfig = ENGINE_CONFIG.exercises.calf_raise,
): RuleDef<CalfRaiseMetrics>[] {
  return [
    {
      code: 'low_raise',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) => (c.summary.pMax < cfg.goodProgress ? {} : null),
    },
    {
      code: 'too_fast',
      kind: 'rep',
      on: ['rep'],
      check: (c) => (c.summary.durationMs < cfg.minRepMs ? {} : null),
    },
  ];
}

export function createCalfRaise(
  cfg: CalfRaiseConfig = ENGINE_CONFIG.exercises.calf_raise,
): ExerciseDef<CalfRaiseMetrics> {
  return {
    id: 'calf_raise',
    requiredJoints: [LM.leftAnkle, LM.rightAnkle, LM.leftFootIndex, LM.rightFootIndex],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new CalfRaiseMeter(cfg),
    rules: calfRaiseRules(cfg),
  };
}
