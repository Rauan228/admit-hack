// Синтетический человек анфас для тестов: честная кинематика в сагиттальной плоскости,
// спроецированная на камеру. Анфас поворот бедра «на камеру» виден только как укорочение
// по вертикали — ровно так, как это видит MediaPipe. Длины сегментов — доли роста.

import type { PoseFrame, Vec3 } from '../../src/engine/geometry';
import type { Landmark } from '../../src/engine/types';

export interface SynthParams {
  /** Ширина / высота кадра. */
  aspect: number;
  /** Центр тела по горизонтали (доля ширины кадра, исходная картинка). */
  centerX: number;
  /** Уровень стоп (доля высоты). */
  footY: number;
  /** Рост в долях высоты кадра. */
  height: number;
  /** Угол бедра от вертикали, градусы: 0 — стоя, 90 — параллельно полу, больше — ниже. */
  thigh: number;
  /** Наклон голени вперёд, градусы. */
  shin: number;
  /** Наклон корпуса вперёд, градусы. */
  lean: number;
  /** 0 — колени по линии стоп, 1 — колени сведены внутрь на 6 % роста. */
  kneeIn: number;
  /** Расстояние между стопами в ширинах таза. */
  stance: number;
  /** Разница в глубине левой и правой ноги, градусы (асимметрия). */
  tilt: number;
  /** Подъём рук от вертикали вниз, градусы (0 — вдоль тела, 180 — над головой). */
  arms: number;
  visibility: number;
}

export const STAND: SynthParams = {
  aspect: 4 / 3,
  centerX: 0.5,
  footY: 0.92,
  height: 0.75,
  thigh: 0,
  shin: 0,
  lean: 0,
  kneeIn: 0,
  stance: 1.2,
  tilt: 0,
  arms: 10,
  visibility: 0.95,
};

const rad = (d: number) => (d * Math.PI) / 180;

/** Поза приседа по глубине бедра: голень и корпус наклоняются пропорционально, как у живого человека. */
export function squatPose(thigh: number, extra: Partial<SynthParams> = {}): SynthParams {
  return { ...STAND, thigh, shin: thigh * 0.35, lean: thigh * 0.33, ...extra };
}

/** 33 точки. Человек стоит лицом к камере: его левая сторона — справа на исходной картинке. */
export function synthFrame(p: SynthParams, t: number, noise: () => number = () => 0): PoseFrame {
  const H = p.height;
  // Длины в долях роста; в плоскости кадра единица — высота кадра.
  const shinL = 0.25 * H;
  const thighL = 0.245 * H;
  const torsoL = 0.3 * H;
  const headL = 0.1 * H;
  const hipW = 0.1 * H;
  const shoulderW = 0.22 * H;
  const armL = 0.32 * H;
  const toX = (planeX: number) => planeX / p.aspect; // плоскость → доля ширины
  const cx = p.centerX * p.aspect;

  const image: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, v: p.visibility }));
  const world: Vec3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const put = (i: number, planeX: number, y: number, wz = 0) => {
    image[i] = { x: toX(planeX) + noise(), y: y + noise(), z: 0, v: p.visibility };
    world[i] = { x: (planeX - cx) / H, y: y / H, z: wz / H };
  };

  let hipY = 0;
  for (const side of [1, -1] as const) {
    // side = +1 — левая сторона человека (справа на картинке).
    const thigh = p.thigh + (side > 0 ? p.tilt / 2 : -p.tilt / 2);
    const ankleX = cx + (side * p.stance * hipW) / 2;
    const ankleY = p.footY;
    const kneeX = ankleX - side * p.kneeIn * 0.06 * H;
    const kneeY = ankleY - shinL * Math.cos(rad(p.shin));
    const kneeZ = -shinL * Math.sin(rad(p.shin));
    const hY = kneeY - thighL * Math.cos(rad(thigh));
    const hZ = kneeZ + thighL * Math.sin(rad(thigh));
    hipY += hY / 2;
    const s =
      side > 0
        ? { ankle: 27, knee: 25, hip: 23, heel: 29, foot: 31 }
        : { ankle: 28, knee: 26, hip: 24, heel: 30, foot: 32 };
    put(s.ankle, ankleX, ankleY);
    put(s.heel, ankleX, ankleY + 0.015 * H, 0.04 * H);
    put(s.foot, ankleX + side * 0.01 * H, ankleY + 0.02 * H, -0.12 * H);
    put(s.knee, kneeX, kneeY, kneeZ);
    put(s.hip, cx + (side * hipW) / 2, hY, hZ);
  }

  const shoulderY = hipY - torsoL * Math.cos(rad(p.lean));
  const noseY = shoulderY - headL * Math.cos(rad(p.lean));
  put(0, cx, noseY);
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) put(i, cx + (i % 2 ? 1 : -1) * 0.02 * H, noseY - 0.01 * H);
  for (const side of [1, -1] as const) {
    const s =
      side > 0
        ? { sh: 11, el: 13, wr: 15, pi: 17, ix: 19, th: 21 }
        : { sh: 12, el: 14, wr: 16, pi: 18, ix: 20, th: 22 };
    const shX = cx + (side * shoulderW) / 2;
    put(s.sh, shX, shoulderY);
    const a = rad(p.arms);
    const wrX = shX + side * Math.sin(a) * armL;
    const wrY = shoulderY + Math.cos(a) * armL;
    put(s.el, (shX + wrX) / 2, (shoulderY + wrY) / 2);
    put(s.wr, wrX, wrY);
    for (const i of [s.pi, s.ix, s.th]) put(i, wrX, wrY + 0.02 * H);
  }
  return { t, aspect: p.aspect, image, world };
}

/** Детерминированный гауссов шум с сигмой sigma (доли кадра). */
export function gaussian(sigma: number, seed = 1): () => number {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return (((x ^ (x >>> 14)) >>> 0) + 1) / 4294967297;
  };
  return () => sigma * Math.sqrt(-2 * Math.log(uni())) * Math.cos(2 * Math.PI * uni());
}

/** Траектория приседаний: список (время, угол бедра). */
export function squatTrack(opts: {
  reps: number;
  depth: number;
  fps?: number;
  downMs?: number;
  holdMs?: number;
  upMs?: number;
  restMs?: number;
  leadMs?: number;
}): { t: number; thigh: number }[] {
  const {
    reps,
    depth,
    fps = 30,
    downMs = 1000,
    holdMs = 200,
    upMs = 900,
    restMs = 600,
    leadMs = 1000,
  } = opts;
  const dt = 1000 / fps;
  const out: { t: number; thigh: number }[] = [];
  const cycle = downMs + holdMs + upMs + restMs;
  const total = leadMs + reps * cycle + 1000;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  for (let t = 0; t <= total; t += dt) {
    const u = t - leadMs;
    let thigh = 0;
    if (u >= 0 && u < reps * cycle) {
      const c = u % cycle;
      if (c < downMs) thigh = depth * ease(c / downMs);
      else if (c < downMs + holdMs) thigh = depth;
      else if (c < downMs + holdMs + upMs) thigh = depth * (1 - ease((c - downMs - holdMs) / upMs));
    }
    out.push({ t, thigh });
  }
  return out;
}
