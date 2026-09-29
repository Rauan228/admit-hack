// Общие меры для упражнений стоя (E-22): корпус, наклоны, углы в суставах. Всё — в плоскости кадра
// с поправкой на аспект (pt) и в долях длины корпуса стоя, чтобы не зависеть от расстояния до камеры.

import { RAD_TO_DEG, angle2, isVisible, mid2, pt, torsoLength, type PoseFrame, type Vec2 } from '../geometry';
import { LM } from '../hints';
import type { Side } from '../types';
import { SlidingQuantile } from './baseline';

/** Верхний квантиль окна для эталонов «стоя»: один выброс модели эталон не раздувает. */
export const REST_Q = 0.9;

export const LEG = {
  left: { hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle, heel: 29, toe: LM.leftFootIndex },
  right: { hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle, heel: 30, toe: LM.rightFootIndex },
} as const;

export const ARM = {
  left: { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist },
  right: { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist },
} as const;

/** Человек лицом к камере: его левая сторона — справа на картинке. Знак «наружу» по x для стороны. */
export const OUTWARD: Record<Side, 1 | -1> = { left: 1, right: -1 };

export const seen = (frame: PoseFrame, i: number, minV = 0.5, margin = 0.05): boolean =>
  isVisible(frame.image[i], minV, margin);

/** Середины плеч и таза, если корпус виден целиком. */
export function trunk(frame: PoseFrame): { shoulder: Vec2; hip: Vec2 } | null {
  const ids = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
  if (!ids.every((i) => seen(frame, i))) return null;
  return {
    shoulder: mid2(pt(frame, LM.leftShoulder), pt(frame, LM.rightShoulder)),
    hip: mid2(pt(frame, LM.leftHip), pt(frame, LM.rightHip)),
  };
}

/** Наклон корпуса вбок в плоскости кадра, градусы: + к левому боку человека (плечи вправо по картинке). */
export function sideTiltDeg(t: { shoulder: Vec2; hip: Vec2 }): number {
  return Math.atan2(t.shoulder.x - t.hip.x, t.hip.y - t.shoulder.y) * RAD_TO_DEG;
}

/** Угол в суставе b по кадру (2D), градусы; null — точки не видны. */
export function joint2(frame: PoseFrame, a: number, b: number, c: number, minV = 0.5): number | null {
  if (![a, b, c].every((i) => seen(frame, i, minV, 0.1))) return null;
  const v = angle2(pt(frame, a), pt(frame, b), pt(frame, c));
  return Number.isFinite(v) ? v : null;
}

/** Длина корпуса стоя (верхний квантиль за окно): единица длины, которую наклон и скручивание не укорачивают. */
export class TorsoRef {
  private readonly q: SlidingQuantile;

  constructor(windowMs: number) {
    this.q = new SlidingQuantile(windowMs, REST_Q);
  }

  update(frame: PoseFrame): number | null {
    const now = torsoLength(frame);
    if (Number.isFinite(now) && now > 0) this.q.push(now, frame.t);
    return this.q.value;
  }

  reset(): void {
    this.q.reset();
  }
}

/** Наибольшее значение поля за кадры (-Infinity — ни разу не измерено). */
export function maxOf<M>(frames: readonly M[], pick: (m: M) => number | null): number {
  let best = -Infinity;
  for (const m of frames) {
    const v = pick(m);
    if (v !== null && v > best) best = v;
  }
  return best;
}

/** Наименьшее значение поля за кадры (Infinity — ни разу не измерено). */
export function minOf<M>(frames: readonly M[], pick: (m: M) => number | null): number {
  let best = Infinity;
  for (const m of frames) {
    const v = pick(m);
    if (v !== null && v < best) best = v;
  }
  return best;
}
