import {
  allVisible,
  angle2,
  angle3,
  angleFromVertical,
  clamp,
  dist2,
  isVisible,
  meanVisibility,
  mid2,
  mirrorX,
  pt,
  tiltFromForeshortening,
  toPlane,
  torsoLength,
  type PoseFrame,
} from '../src/engine/geometry';
import type { Landmark } from '../src/engine/types';

const lm = (x: number, y: number, v = 1): Landmark => ({ x, y, z: 0, v });

function frameWith(points: Record<number, Landmark>, aspect = 1): PoseFrame {
  const image = Array.from({ length: 33 }, (_, i) => points[i] ?? lm(0.5, 0.5, 0));
  return { t: 0, aspect, image, world: null };
}

describe('углы', () => {
  it('прямой угол — 90°, прямая линия — 180°, сложенный сустав — 0°', () => {
    expect(angle2({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(90);
    expect(angle2({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })).toBeCloseTo(180);
    expect(angle2({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 })).toBeCloseTo(0);
  });

  it('нулевой отрезок даёт NaN, а не ложный угол', () => {
    expect(angle2({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNaN();
  });

  it('3D-угол видит сгиб, который в проекции не заметен', () => {
    // Бедро уходит на камеру (по z): анфас в 2D колено почти прямое, в 3D — 90°.
    const hip = { x: 0, y: 0.5, z: -0.45 };
    const knee = { x: 0, y: 0.45, z: 0 };
    const ankle = { x: 0, y: 0.9, z: 0 };
    expect(angle3(hip, knee, ankle)).toBeGreaterThan(80);
    expect(angle2(hip, knee, ankle)).toBeLessThan(10);
  });

  it('поправка на аспект: в кадре 16:9 «диагональ» 45° на самом деле положе', () => {
    const a = lm(0, 0);
    const b = lm(0, 1);
    const c = lm(1, 0);
    // Без поправки (аспект 1) угол 45°, с поправкой на широкий кадр он другой.
    expect(angle2(toPlane(a, 1), toPlane(b, 1), toPlane(c, 1))).toBeCloseTo(45);
    const wide = angle2(toPlane(a, 16 / 9), toPlane(b, 16 / 9), toPlane(c, 16 / 9));
    expect(wide).toBeCloseTo((Math.atan(16 / 9) * 180) / Math.PI, 5);
  });

  it('угол от вертикали: вверх 0°, вбок 90°, вниз 180°', () => {
    const o = { x: 0.5, y: 0.5 };
    expect(angleFromVertical(o, { x: 0.5, y: 0.2 })).toBeCloseTo(0);
    expect(angleFromVertical(o, { x: 0.8, y: 0.5 })).toBeCloseTo(90);
    expect(angleFromVertical(o, { x: 0.5, y: 0.9 })).toBeCloseTo(180);
    expect(angleFromVertical(o, { x: 0.6, y: 0.4 })).toBeCloseTo(45);
  });

  it('наклон по укорочению: половина длины — 60°, полная — 0°', () => {
    expect(tiltFromForeshortening(0.5, 1)).toBeCloseTo(60);
    expect(tiltFromForeshortening(1, 1)).toBeCloseTo(0);
    // Шум может дать «длиннее, чем стоя»: это 0°, а не NaN.
    expect(tiltFromForeshortening(1.05, 1)).toBeCloseTo(0);
    expect(tiltFromForeshortening(0.5, 0)).toBeNaN();
  });
});

describe('расстояния и масштаб', () => {
  it('dist2 и mid2', () => {
    expect(dist2({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(mid2({ x: 0, y: 0 }, { x: 2, y: 4 })).toEqual({ x: 1, y: 2 });
  });

  it('длина корпуса считается в плоскости с поправкой на аспект', () => {
    const f = frameWith({ 11: lm(0.4, 0.3), 12: lm(0.6, 0.3), 23: lm(0.45, 0.6), 24: lm(0.55, 0.6) }, 4 / 3);
    expect(torsoLength(f)).toBeCloseTo(0.3);
    expect(pt(f, 11)).toEqual({ x: 0.4 * (4 / 3), y: 0.3 });
  });

  it('зеркало для экрана', () => {
    expect(mirrorX(0.2)).toBeCloseTo(0.8);
  });

  it('clamp', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });
});

describe('видимость', () => {
  it('точка видна только с уверенностью и внутри кадра', () => {
    expect(isVisible(lm(0.5, 0.5, 0.9))).toBe(true);
    expect(isVisible(lm(0.5, 0.5, 0.3))).toBe(false);
    expect(isVisible(lm(0.5, 1.2, 0.9))).toBe(false);
    expect(isVisible(lm(0.5, 1.02, 0.9), 0.5, 0.05)).toBe(true);
    expect(isVisible(undefined)).toBe(false);
  });

  it('allVisible и meanVisibility', () => {
    const f = frameWith({ 0: lm(0.5, 0.2, 0.9), 27: lm(0.4, 0.95, 0.2) });
    expect(allVisible(f, [0])).toBe(true);
    expect(allVisible(f, [0, 27])).toBe(false);
    expect(meanVisibility(f, [0, 27])).toBeCloseTo(0.55);
    expect(meanVisibility(f, [])).toBe(0);
  });
});
