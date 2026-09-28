// Эталонный скелет: честная кинематика тела в сагиттальной плоскости, спроецированная на камеру анфас.
// Анфас поворот бедра «на камеру» виден только как укорочение по вертикали — ровно так, как это видит MediaPipe.
// Длины сегментов — доли роста; мировые точки — как у MediaPipe (y вниз, z от камеры).
// Используется «призраком» (ghostPoses.ts) и тестами: призрак показывает ровно то, что движок считает правильным.

import type { PoseFrame, Vec3 } from './geometry';
import type { Landmark } from './types';

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
  /** Сдвиг таза вбок по исходной картинке, в ширинах таза (перенос веса на одну ногу). */
  shift: number;
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
  shift: 0,
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
  let hipZ = 0;
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
    hipZ += hZ / 2;
    const s =
      side > 0
        ? { ankle: 27, knee: 25, hip: 23, heel: 29, foot: 31 }
        : { ankle: 28, knee: 26, hip: 24, heel: 30, foot: 32 };
    put(s.ankle, ankleX, ankleY);
    put(s.heel, ankleX, ankleY + 0.015 * H, 0.04 * H);
    put(s.foot, ankleX + side * 0.01 * H, ankleY + 0.02 * H, -0.12 * H);
    put(s.knee, kneeX, kneeY, kneeZ);
    put(s.hip, cx + p.shift * hipW + (side * hipW) / 2, hY, hZ);
  }

  const shoulderY = hipY - torsoL * Math.cos(rad(p.lean));
  // Наклон вперёд — плечи уходят к камере (минус по z).
  const shoulderZ = hipZ - torsoL * Math.sin(rad(p.lean));
  const noseY = shoulderY - headL * Math.cos(rad(p.lean));
  const noseZ = shoulderZ - headL * Math.sin(rad(p.lean));
  put(0, cx, noseY, noseZ);
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    put(i, cx + (i % 2 ? 1 : -1) * 0.02 * H, noseY - 0.01 * H, noseZ);
  for (const side of [1, -1] as const) {
    const s =
      side > 0
        ? { sh: 11, el: 13, wr: 15, pi: 17, ix: 19, th: 21 }
        : { sh: 12, el: 14, wr: 16, pi: 18, ix: 20, th: 22 };
    const shX = cx + (side * shoulderW) / 2;
    put(s.sh, shX, shoulderY, shoulderZ);
    const a = rad(p.arms);
    const wrX = shX + side * Math.sin(a) * armL;
    const wrY = shoulderY + Math.cos(a) * armL;
    put(s.el, (shX + wrX) / 2, (shoulderY + wrY) / 2);
    put(s.wr, wrX, wrY);
    for (const i of [s.pi, s.ix, s.th]) put(i, wrX, wrY + 0.02 * H);
  }
  return { t, aspect: p.aspect, image, world };
}

export interface LungeParams {
  /** 0 — стоя, 1 — заднее колено у пола, переднее бедро горизонтально. */
  depth: number;
  /** Какая нога сзади. */
  back: 'left' | 'right';
  /** Колено передней ноги впереди носка, метры (ошибка «колено за носком»). */
  kneeForward?: number;
  /** Наклон корпуса вперёд, градусы. */
  lean?: number;
  aspect?: number;
  height?: number;
  footY?: number;
}

/**
 * Выпад анфас. Мировые точки — в метрах (рост 1,7 м), ось y вниз, z — от камеры, как у MediaPipe.
 * Переднее бедро уходит к горизонтали (на камеру), заднее колено опускается к полу, задняя стопа — на носке.
 */
export function lungeFrame(p: LungeParams, t: number, noise: () => number = () => 0): PoseFrame {
  const aspect = p.aspect ?? 4 / 3;
  const H = p.height ?? 0.75;
  const footY = p.footY ?? 0.92;
  const M = 1.7 / H; // доли кадра → метры
  const shin = 0.25 * H;
  const thigh = 0.245 * H;
  const torso = 0.3 * H;
  const hipW = 0.1 * H;
  const shoulderW = 0.22 * H;
  const cx = 0.5 * aspect;
  const d = p.depth;
  const hipY = footY - (shin + thigh) + d * thigh;
  const image: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, v: 0.95 }));
  const world: Vec3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const put = (i: number, x: number, y: number, z: number) => {
    image[i] = { x: x / aspect + noise(), y: y + noise(), z: 0, v: 0.95 };
    world[i] = { x: (x - cx) * M, y: (y - hipY) * M, z: z * M };
  };
  const I = {
    left: { hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31, sign: 1 },
    right: { hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32, sign: -1 },
  };
  const front = p.back === 'left' ? I.right : I.left;
  const back = p.back === 'left' ? I.left : I.right;
  // Передняя нога: голень вертикальна, бедро наклоняется вперёд (на камеру) до горизонтали.
  const frontKneeY = footY - shin;
  const cosF = Math.max(-1, Math.min(1, (frontKneeY - hipY) / thigh));
  const step = thigh * Math.sqrt(1 - cosF * cosF); // вынос колена вперёд
  const fx = cx + (front.sign * hipW) / 2;
  const kf = (p.kneeForward ?? 0) / M;
  const toeZ = -step - 0.1 * H;
  // Обычно колено над щиколоткой, позади носка; «колено вперёд» — впереди носка на kneeForward метров.
  const kneeZ = kf > 0 ? toeZ - kf : -step - 0.02 * H;
  put(front.hip, fx, hipY, 0);
  put(front.knee, fx, frontKneeY, kneeZ);
  put(front.ankle, fx, footY, -step);
  put(front.heel, fx, footY + 0.01 * H, -step + 0.03 * H);
  put(front.toe, fx, footY + 0.02 * H, toeZ);
  // Задняя нога: бедро почти вертикально, колено опускается к полу, стопа сзади на носке.
  const bx = cx + (back.sign * hipW) / 2;
  const backKneeY = hipY + thigh * Math.cos(0.25 * d);
  const backShinDrop = Math.max(0, footY - 0.03 * H * d - backKneeY);
  const backShinBack = Math.sqrt(Math.max(0, shin * shin - backShinDrop * backShinDrop));
  put(back.hip, bx, hipY, 0);
  put(back.knee, bx, backKneeY, thigh * Math.sin(0.25 * d));
  put(back.ankle, bx, backKneeY + backShinDrop, thigh * Math.sin(0.25 * d) + backShinBack);
  put(back.heel, bx, backKneeY + backShinDrop, thigh * Math.sin(0.25 * d) + backShinBack + 0.02 * H);
  put(back.toe, bx, footY, thigh * Math.sin(0.25 * d) + backShinBack - 0.05 * H);
  // Корпус, голова, руки (руки на поясе).
  const lean = ((p.lean ?? 0) * Math.PI) / 180;
  const shY = hipY - torso * Math.cos(lean);
  const shZ = -torso * Math.sin(lean);
  put(0, cx, shY - 0.1 * H, shZ - 0.03 * H);
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    put(i, cx + (i % 2 ? 1 : -1) * 0.02 * H, shY - 0.11 * H, shZ);
  for (const [sh, el, wr, sign] of [
    [11, 13, 15, 1],
    [12, 14, 16, -1],
  ] as const) {
    const sx = cx + (sign * shoulderW) / 2;
    put(sh, sx, shY, shZ);
    put(el, sx + sign * 0.06 * H, shY + 0.14 * H, shZ);
    put(wr, cx + (sign * hipW) / 2 + sign * 0.03 * H, hipY - 0.02 * H, 0);
    for (const i of sign > 0 ? [17, 19, 21] : [18, 20, 22])
      put(i, cx + (sign * hipW) / 2 + sign * 0.03 * H, hipY, 0);
  }
  return { t, aspect, image, world };
}
