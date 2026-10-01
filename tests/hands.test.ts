// Кисти (E-36): кулак или ладонь по 21 3D-точке Hand Landmarker; вырезка кадра вокруг кисти по точкам позы.

import type { PoseFrame, Vec3 } from '../src/engine/geometry';
import { classifyHand, handRoi } from '../src/engine/hands';
import type { Landmark } from '../src/engine/types';

/**
 * Синтетическая кисть в метрах: запястье в нуле, четыре пальца веером в плоскости ладони (x, y),
 * основание на 0,09 м от запястья, палец 0,075 м. curl 0 — прямой палец, 1 — согнут в кулак:
 * кончик уходит вниз (к ладони, −z) и назад к основанию.
 */
function hand(curl: number | number[], thumbOut = true): Vec3[] {
  const curls = Array.isArray(curl) ? curl : [curl, curl, curl, curl];
  const pts: Vec3[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  // Большой палец (1–4) — сбоку, его классификатор не считает.
  for (let i = 1; i <= 4; i += 1) pts[i] = { x: (thumbOut ? 0.02 : 0.01) * i, y: 0.015 * i, z: 0 };
  const angles = [-0.25, -0.08, 0.08, 0.25];
  angles.forEach((a, f) => {
    const d = { x: Math.sin(a), y: Math.cos(a) };
    const k = curls[f] ?? 0;
    const base = 5 + f * 4;
    pts[base] = { x: d.x * 0.09, y: d.y * 0.09, z: 0 };
    // Сустав и кончик: при сгибе фаланги заворачиваются вниз и назад.
    const seg = (len: number, bend: number) => ({
      x: d.x * len * Math.cos(bend),
      y: d.y * len * Math.cos(bend),
      z: -len * Math.sin(bend),
    });
    const bend = (k * Math.PI) / 2.2;
    const pip = seg(0.03, bend);
    const dip = seg(0.025, bend * 2);
    const tip = seg(0.02, bend * 3);
    const P = pts[base]!;
    pts[base + 1] = { x: P.x + pip.x, y: P.y + pip.y, z: P.z + pip.z };
    pts[base + 2] = { x: pts[base + 1]!.x + dip.x, y: pts[base + 1]!.y + dip.y, z: pts[base + 1]!.z + dip.z };
    pts[base + 3] = { x: pts[base + 2]!.x + tip.x, y: pts[base + 2]!.y + tip.y, z: pts[base + 2]!.z + tip.z };
  });
  return pts;
}

describe('кисть: кулак или ладонь', () => {
  it('прямые пальцы — ладонь, согнутые — кулак', () => {
    expect(classifyHand(hand(0))).toBe('open');
    expect(classifyHand(hand(1))).toBe('fist');
  });

  it('полусогнутые пальцы (расслабленная кисть) — неизвестно, удар не запрещаем', () => {
    expect(classifyHand(hand(0.5))).toBe('unknown');
  });

  it('три пальца согнуты, один торчит — не кулак и не ладонь', () => {
    expect(classifyHand(hand([1, 1, 1, 0]))).toBe('unknown');
    // Три прямых и один согнутый — ладонь (ладонью бьют и так).
    expect(classifyHand(hand([0, 0, 0, 1]))).toBe('open');
  });

  it('точек меньше 21 или их нет — неизвестно', () => {
    expect(classifyHand([])).toBe('unknown');
    expect(classifyHand(hand(1).slice(0, 15))).toBe('unknown');
  });
});

describe('кисть: вырезка кадра по точкам позы', () => {
  const frame = (o: { wristV?: number; knuckles?: boolean; wx?: number; wy?: number }): PoseFrame => {
    const image: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, v: 0 }));
    const wx = o.wx ?? 0.3;
    const wy = o.wy ?? 0.5;
    image[15] = { x: wx, y: wy, z: 0, v: o.wristV ?? 1 };
    if (o.knuckles !== false) {
      image[19] = { x: wx - 0.05, y: wy - 0.02, z: 0, v: 1 };
      image[17] = { x: wx - 0.04, y: wy + 0.03, z: 0, v: 1 };
    }
    return { t: 0, aspect: 4 / 3, image, world: null };
  };

  it('квадрат вокруг кисти, целиком в кадре, в долях ширины и высоты', () => {
    const roi = handRoi(frame({}), 'left', 640, 480)!;
    expect(roi).not.toBeNull();
    // Квадрат в пикселях: ширина × 640 = высота × 480.
    expect(roi.w * 640).toBeCloseTo(roi.h * 480, 5);
    expect(roi.x).toBeGreaterThanOrEqual(0);
    expect(roi.y).toBeGreaterThanOrEqual(0);
    expect(roi.x + roi.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(roi.y + roi.h).toBeLessThanOrEqual(1 + 1e-9);
    // Центр — между запястьем и костяшками.
    const cx = roi.x + roi.w / 2;
    expect(cx).toBeLessThan(0.3);
    expect(cx).toBeGreaterThan(0.25);
  });

  it('кисть у края кадра — квадрат прижат к краю, а не обрезан', () => {
    const roi = handRoi(frame({ wx: 0.01, wy: 0.02 }), 'left', 640, 480)!;
    expect(roi.x).toBe(0);
    expect(roi.y).toBe(0);
    expect(roi.w * 640).toBeCloseTo(roi.h * 480, 5);
  });

  it('костяшек не видно — квадрат минимального размера вокруг запястья', () => {
    const roi = handRoi(frame({ knuckles: false }), 'left', 640, 480)!;
    expect(roi.w * 640).toBeCloseTo(48, 5);
    expect(roi.x + roi.w / 2).toBeCloseTo(0.3, 3);
  });

  it('запястья не видно — вырезки нет', () => {
    expect(handRoi(frame({ wristV: 0.1 }), 'left', 640, 480)).toBeNull();
    expect(handRoi(frame({}), 'right', 640, 480)).toBeNull();
  });
});
