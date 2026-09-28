// Приседания (E-08): глубина, прогресс и счёт.
//
// Глубину меряем не углом колена, а «вертикалью бедра»: насколько колено ниже таза.
// Анфас бедро в приседе уходит на камеру, и 2D-угол колена почти не меняется — а высота таза
// относительно колена видна с любого ракурса. «Бедро параллельно полу» — ровно «таз на уровне
// колена», то есть вертикаль бедра 0.
//
// Вертикаль бедра делим на вертикаль голени того же кадра, а потом на это же отношение стоя.
// Так мера не зависит от расстояния до камеры: человек отошёл — укоротились обе вертикали,
// отношение то же. Первая версия делила на бедро стоя, и уход от камеры выглядел как начало
// приседа: счётчик уходил в «down» и зависал (поймал тест).

import { ENGINE_CONFIG } from '../config';
import { isVisible, pt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { Phase } from '../types';
import { SlidingMax } from './baseline';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type SquatConfig = typeof ENGINE_CONFIG.exercises.squat;

export interface SquatMetrics extends BaseMetrics {
  /** Глубина по бедру: 1 — стоя, 0 — бедро параллельно полу, < 0 — ниже. */
  thighRatio: number;
  /** То же по каждой ноге (null — нога не видна). */
  thighRatioL: number | null;
  thighRatioR: number | null;
}

const LEGS = {
  left: { hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle },
  right: { hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle },
} as const;

/** Голень короче этой доли высоты кадра — точки слиплись, делить на неё нельзя. */
const MIN_SHIN = 0.02;

/** Прогресс по отношению бедра: 0 стоя, 1 — у параллели, больше — глубже. */
export function squatProgress(thighRatio: number, cfg: SquatConfig = ENGINE_CONFIG.exercises.squat): number {
  return (1 - thighRatio) / (1 - cfg.parallelRatio);
}

class SquatMeter implements ExerciseMeter<SquatMetrics> {
  private readonly base: Record<'left' | 'right', SlidingMax>;

  constructor(private readonly cfg: SquatConfig) {
    // В конструкторе, а не инициализатором поля: при target ES2022 поля создаются раньше, чем cfg.
    this.base = { left: new SlidingMax(cfg.baselineWindowMs), right: new SlidingMax(cfg.baselineWindowMs) };
  }

  measure(frame: PoseFrame, phase: Phase): SquatMetrics | null {
    const ratio = (side: 'left' | 'right'): number | null => {
      const { hip, knee, ankle } = LEGS[side];
      const seen = (i: number) => isVisible(frame.image[i], 0.5, 0.05);
      if (!seen(hip) || !seen(knee) || !seen(ankle)) return null;
      const shin = pt(frame, ankle).y - pt(frame, knee).y;
      if (shin < MIN_SHIN) return null;
      const thighToShin = (pt(frame, knee).y - pt(frame, hip).y) / shin;
      const base = this.base[side];
      // Эталон обновляем, только пока человек стоит (или эталона ещё нет вовсе).
      if (phase === 'start' || base.value === null) base.push(thighToShin, frame.t);
      else base.expire(frame.t);
      const standing = base.value;
      return standing && standing > 0 ? thighToShin / standing : null;
    };
    const l = ratio('left');
    const r = ratio('right');
    if (l === null && r === null) return null;
    // Анфас и со спины видны обе ноги — усредняем; сбоку дальняя закрыта — берём видимую.
    const thighRatio = l !== null && r !== null ? (l + r) / 2 : ((l ?? r) as number);
    return { progress: squatProgress(thighRatio, this.cfg), thighRatio, thighRatioL: l, thighRatioR: r };
  }

  reset(): void {
    this.base.left.reset();
    this.base.right.reset();
  }
}

export function createSquat(cfg: SquatConfig = ENGINE_CONFIG.exercises.squat): ExerciseDef<SquatMetrics> {
  return {
    id: 'squat',
    requiredJoints: [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new SquatMeter(cfg),
  };
}
