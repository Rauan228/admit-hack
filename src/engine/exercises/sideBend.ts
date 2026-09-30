// Наклоны в стороны (E-22): стоя лицом к камере, корпус наклоняется вбок, таз на месте.
//
// Прогресс — наклон корпуса (середина таза → середина плеч) от вертикали в плоскости кадра, в долях goodTiltDeg.
// Анфас наклон вбок лежит ровно в плоскости кадра, поэтому 2D-угол честный. Каждый наклон — повтор,
// в любую сторону. Ошибки: наклон вперёд вместо вбок (по 3D-точкам), таз уехал вбок вместе с корпусом.

import { ENGINE_CONFIG, type Widen } from '../config';
import { dist2, pt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Phase, Side } from '../types';
import { seen, sideTiltDeg, trunk } from './common';
import { leanBackDeg } from './highKnees';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type SideBendConfig = Widen<typeof ENGINE_CONFIG.exercises.side_bend>;

export interface SideBendMetrics extends BaseMetrics {
  /** Наклон вбок, градусы: + к левому боку человека. */
  tilt: number;
  side: Side;
  /** Наклон вперёд по 3D-точкам, градусы (null — нет 3D). */
  forward: number | null;
  /** Сдвиг таза над серединой стоп в сторону наклона, в ширинах таза (null — стопы не видны). */
  hipShift: number | null;
}

class SideBendMeter implements ExerciseMeter<SideBendMetrics> {
  /** В какую сторону идёт текущий наклон (null — стоим прямо). */
  private bendSide: Side | null = null;

  constructor(private readonly cfg: SideBendConfig) {}

  measure(frame: PoseFrame, phase: Phase): SideBendMetrics | null {
    const t = trunk(frame);
    if (!t) return null;
    const tilt = sideTiltDeg(t);
    // Лёг или упал — это не наклон стоя.
    if (!(Math.abs(tilt) <= 75)) return null;
    const side: Side = tilt >= 0 ? 'left' : 'right';
    const back = leanBackDeg(frame);
    let hipShift: number | null = null;
    if (seen(frame, LM.leftAnkle) && seen(frame, LM.rightAnkle)) {
      const hipWidth = dist2(pt(frame, LM.leftHip), pt(frame, LM.rightHip));
      const feet = (pt(frame, LM.leftAnkle).x + pt(frame, LM.rightAnkle).x) / 2;
      // + — таз уехал туда же, куда наклон (человек валится всем телом, а не гнётся в боку).
      if (hipWidth > 0) hipShift = ((t.hip.x - feet) / hipWidth) * (side === 'left' ? 1 : -1);
    }
    const progress = Math.abs(tilt) / this.cfg.goodTiltDeg;
    const { startMax, downMin } = this.cfg.fsm;
    if (phase === 'start') this.bendSide = null;
    else if (this.bendSide === null && progress >= startMax) this.bendSide = side;
    // Наклоны «маятником» (влево — сразу вправо) проходят вертикаль за доли секунды: в «прямо» человек
    // не задерживается, и счётчик склеивал два наклона в один. Смена стороны у вертикали и есть возврат.
    // Большой наклон в другую сторону за кадр — сбой модели, а не проход через вертикаль.
    const returned = phase === 'up' && this.bendSide !== null && side !== this.bendSide && progress < downMin;
    return {
      progress,
      returned,
      tilt,
      side,
      forward: back === null ? null : -back,
      hipShift,
    };
  }

  reset(): void {
    this.bendSide = null;
  }
}

export function sideBendRules(
  cfg: SideBendConfig = ENGINE_CONFIG.exercises.side_bend,
): RuleDef<SideBendMetrics>[] {
  return [
    {
      code: 'shallow_bend',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) => {
        if (c.summary.pMax >= cfg.goodProgress) return null;
        const shoulder = c.atBottom.side === 'left' ? LM.leftShoulder : LM.rightShoulder;
        return { joints: [shoulder] };
      },
    },
    {
      code: 'lean_forward',
      kind: 'frame',
      check: (m) => (m.forward !== null && m.forward > cfg.maxForwardDeg ? {} : null),
    },
    {
      code: 'hips_shift',
      kind: 'frame',
      check: (m) =>
        m.hipShift !== null && m.progress >= cfg.hipShiftMinProgress && m.hipShift > cfg.maxHipShift
          ? {}
          : null,
    },
  ];
}

export function createSideBend(
  cfg: SideBendConfig = ENGINE_CONFIG.exercises.side_bend,
): ExerciseDef<SideBendMetrics> {
  return {
    id: 'side_bend',
    requiredJoints: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new SideBendMeter(cfg),
    rules: sideBendRules(cfg),
  };
}
