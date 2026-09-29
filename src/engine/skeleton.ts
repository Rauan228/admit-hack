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
  /** Отдельный угол для левой руки (иначе как у обеих). */
  armsL?: number;
  /** Сгиб в локте, градусы (0 — прямая рука): предплечье поворачивается к голове. */
  elbow?: number;
  /**
   * Подъём колена одной ноги (высокие колени, локоть к колену): угол бедра от вертикали вперёд, градусы.
   * Голень висит вертикально, опорная нога прямая.
   */
  liftL?: number;
  liftR?: number;
  /** Руки за головой, локти в стороны (вместо arms/elbow). */
  handsBehindHead?: boolean;
  /** Скручивание: локоть crunchElbow тянется к противоположному колену; 0 — нет, 1 — касание. */
  crunch?: number;
  crunchElbow?: 'left' | 'right';
  /** Наклон корпуса вбок в плоскости кадра, градусы: + к левому боку человека (вправо по картинке). */
  sideTilt?: number;
  /** Отведение прямой ноги в сторону, градусы от вертикали. */
  abductL?: number;
  abductR?: number;
  /** Голень отведённой ноги отстаёт к вертикали на столько градусов (колено согнуто). */
  abductKnee?: number;
  /** Подъём на носки: всё, кроме носков, выше на такую долю роста. */
  onToes?: number;
  /** Руки в стороны на уровне плеч: 0 — широко, 1 — скрещены перед грудью. */
  armsIn?: number;
  /** Круги руками: руки в стороны, кисть на круге радиуса radius (доля роста), угол angle от верха. */
  circle?: { angle: number; radius: number };
  /** Удар на камеру: 0 — рука в защите у подбородка, 1 — прямая рука вперёд. */
  punchL?: number;
  punchR?: number;
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
  /** Центр вращения корпуса при наклоне вбок — середина таза (известна, когда ставим верх тела). */
  const pivot = { x: cx + p.shift * 0.1 * H, y: 0 };
  const tilt = rad(p.sideTilt ?? 0);
  const put = (i: number, planeX: number, y: number, wz = 0, imageZ = 0) => {
    if (tilt && i <= 22) {
      // Верх тела поворачивается вокруг середины таза: «вверх» уходит к +x на sideTilt.
      const dx = planeX - pivot.x;
      const dy = y - pivot.y;
      planeX = pivot.x + dx * Math.cos(tilt) - dy * Math.sin(tilt);
      y = pivot.y + dx * Math.sin(tilt) + dy * Math.cos(tilt);
    }
    // Подъём на носки: всё выше, кроме самих носков (31, 32).
    if (p.onToes && i !== 31 && i !== 32) y -= p.onToes * H;
    image[i] = { x: toX(planeX) + noise(), y: y + noise(), z: toX(imageZ), v: p.visibility };
    world[i] = { x: (planeX - cx) / H, y: y / H, z: wz / H };
  };

  let hipY = 0;
  let hipZ = 0;
  /** Колени в плоскости кадра — к ним тянется локоть при скручивании. */
  const knees = { left: { x: cx, y: p.footY }, right: { x: cx, y: p.footY } };
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
    const hipX = cx + p.shift * hipW + (side * hipW) / 2;
    const lift = side > 0 ? p.liftL : p.liftR;
    const abduct = side > 0 ? p.abductL : p.abductR;
    // Порядок точек (стопа → колено → таз) не меняем: от него зависит шум, на котором построены тесты.
    if (abduct) {
      // Прямая нога в сторону от таза; согнутое колено — голень отстаёт к вертикали.
      const a = rad(abduct);
      const b = rad(abduct - (p.abductKnee ?? 0));
      const kX = hipX + side * Math.sin(a) * thighL;
      const kY = hY + Math.cos(a) * thighL;
      const aX = kX + side * Math.sin(b) * shinL;
      const aY = kY + Math.cos(b) * shinL;
      put(s.ankle, aX, aY);
      put(s.heel, aX, aY + 0.015 * H, 0.04 * H);
      put(s.foot, aX + side * 0.01 * H, aY + 0.02 * H, -0.12 * H);
      put(s.knee, kX, kY);
      knees[side > 0 ? 'left' : 'right'] = { x: kX, y: kY };
    } else if (lift) {
      // Колено вперёд-вверх (на камеру), голень висит вертикально под коленом.
      const kY = hY + thighL * Math.cos(rad(lift));
      const kZ = hZ - thighL * Math.sin(rad(lift));
      put(s.ankle, hipX, kY + shinL, kZ);
      put(s.heel, hipX, kY + shinL + 0.015 * H, kZ + 0.04 * H);
      put(s.foot, hipX + side * 0.01 * H, kY + shinL + 0.02 * H, kZ - 0.12 * H);
      put(s.knee, hipX, kY, kZ);
      knees[side > 0 ? 'left' : 'right'] = { x: hipX, y: kY };
    } else {
      put(s.ankle, ankleX, ankleY);
      put(s.heel, ankleX, ankleY + 0.015 * H, 0.04 * H);
      put(s.foot, ankleX + side * 0.01 * H, ankleY + 0.02 * H, -0.12 * H);
      put(s.knee, kneeX, kneeY, kneeZ);
      knees[side > 0 ? 'left' : 'right'] = { x: kneeX, y: kneeY };
    }
    put(s.hip, hipX, hY, hZ);
  }

  pivot.y = hipY;
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
    let shX = cx + (side * shoulderW) / 2;
    let shY = shoulderY;
    const me = side > 0 ? 'left' : 'right';
    const crunch = p.handsBehindHead && p.crunchElbow === me ? (p.crunch ?? 0) : 0;
    const knee = knees[me === 'left' ? 'right' : 'left'];
    if (crunch) {
      // Скручивание: плечо рабочей стороны уходит вниз и к середине, навстречу колену.
      shX += (knee.x - shX) * 0.25 * crunch;
      shY += (knee.y - shY) * 0.2 * crunch;
    }
    put(s.sh, shX, shY, shoulderZ);
    if (p.handsBehindHead) {
      // Локти в стороны на уровне ушей, кисти за затылком.
      let elX = shX + side * 0.15 * H;
      let elY = shY - 0.03 * H;
      let wrX = cx + side * 0.035 * H;
      let wrY = noseY - 0.02 * H;
      if (crunch) {
        // Локоть — к противоположному колену (садится на него сверху), кисть тянется следом.
        const toX = knee.x;
        const toY = knee.y - 0.04 * H;
        wrX += (toX - elX) * crunch * 0.5;
        wrY += (toY - elY) * crunch * 0.5;
        elX += (toX - elX) * crunch;
        elY += (toY - elY) * crunch;
      }
      put(s.el, elX, elY, shoulderZ);
      put(s.wr, wrX, wrY, noseZ + 0.06 * H);
      for (const i of [s.pi, s.ix, s.th]) put(i, wrX, wrY + 0.02 * H, noseZ + 0.06 * H);
      continue;
    }
    const punch = side > 0 ? p.punchL : p.punchR;
    if (punch !== undefined) {
      // Бокс: из защиты (кисть у подбородка, локоть внизу) — прямая рука вперёд, на камеру.
      const k = punch;
      const elX = shX - side * 0.03 * H + side * 0.01 * H * k;
      const elY = shY + 0.13 * H - 0.12 * H * k;
      const elZ = shoulderZ - 0.05 * H - (armL / 2 - 0.05 * H) * k;
      const wrX = cx + side * 0.05 * H + (shX - side * 0.04 * H - cx - side * 0.05 * H) * k;
      const wrY = noseY + 0.04 * H + (shY + 0.01 * H - noseY - 0.04 * H) * k;
      const wrZ = shoulderZ - 0.12 * H - (armL - 0.12 * H) * k;
      put(s.el, elX, elY, elZ, elZ - shoulderZ);
      put(s.wr, wrX, wrY, wrZ, wrZ - shoulderZ);
      for (const i of [s.pi, s.ix, s.th]) put(i, wrX, wrY + 0.02 * H, wrZ, wrZ - shoulderZ);
      continue;
    }
    if (p.armsIn !== undefined || p.circle) {
      // Руки в стороны на уровне плеч: «звёздочка» с перекрёстом (armsIn) или круги руками (circle).
      let wrX = shX + side * armL;
      let wrY = shY + 0.02 * H;
      let wrZ = shoulderZ;
      if (p.armsIn !== undefined) {
        wrX += (cx - side * 0.08 * H - wrX) * p.armsIn;
        wrZ -= 0.25 * H * Math.sin(Math.PI * Math.min(1, p.armsIn));
      }
      if (p.circle) {
        // Обе руки крутятся зеркально — как у живого человека.
        wrX += side * p.circle.radius * H * Math.sin(p.circle.angle);
        wrY -= p.circle.radius * H * Math.cos(p.circle.angle);
      }
      const elX = (shX + wrX) / 2;
      const elY = (shY + wrY) / 2;
      put(s.el, elX, elY, (shoulderZ + wrZ) / 2);
      put(s.wr, wrX, wrY, wrZ);
      for (const i of [s.pi, s.ix, s.th]) put(i, wrX, wrY + 0.02 * H, wrZ);
      continue;
    }
    const a = rad(side > 0 && p.armsL !== undefined ? p.armsL : p.arms);
    const bend = rad(p.elbow ?? 0);
    const elX = shX + (side * Math.sin(a) * armL) / 2;
    const elY = shY + (Math.cos(a) * armL) / 2;
    // Предплечье продолжает плечо, повёрнутое на сгиб локтя (к голове).
    const wrX = elX + (side * Math.sin(a + bend) * armL) / 2;
    const wrY = elY + (Math.cos(a + bend) * armL) / 2;
    put(s.el, elX, elY);
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

export interface SideLungeParams {
  /** 0 — стоя в широкой стойке, 1 — бедро согнутой ноги параллельно полу. */
  depth: number;
  /** Какая нога сгибается. */
  side: 'left' | 'right';
  /** Полуширина стойки: стопы на столько доль роста от центра (0,3 — широкая, как в «казачьем» выпаде). */
  stance?: number;
  /** Колено согнутой ноги заваливается внутрь: 0 — по линии носка, 1 — на 8 % роста. */
  kneeIn?: number;
  /** Наклон корпуса вперёд, градусы. */
  lean?: number;
  aspect?: number;
  height?: number;
  footY?: number;
}

/** Колено двухзвенной ноги между тазом и щиколоткой в плоскости кадра; bendSign — куда выгнуто колено по x. */
function kneeIK(
  hip: { x: number; y: number },
  ankle: { x: number; y: number },
  thigh: number,
  shin: number,
  bendSign: number,
): { x: number; y: number } {
  const dx = ankle.x - hip.x;
  const dy = ankle.y - hip.y;
  const d = Math.hypot(dx, dy);
  // Не дотягивается — нога прямая (колено на отрезке).
  if (d >= thigh + shin) return { x: hip.x + (dx * thigh) / d, y: hip.y + (dy * thigh) / d };
  const a = (thigh * thigh - shin * shin + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, thigh * thigh - a * a));
  const mx = hip.x + (dx * a) / d;
  const my = hip.y + (dy * a) / d;
  // Два решения — по обе стороны от линии таз → щиколотка; берём то, что выгнуто в сторону bendSign.
  const k1 = { x: mx + (h * dy) / d, y: my - (h * dx) / d };
  const k2 = { x: mx - (h * dy) / d, y: my + (h * dx) / d };
  return Math.sign(k1.x - mx) === Math.sign(bendSign) ? k1 : k2;
}

/**
 * Боковой («казачий») выпад анфас: стопы широко, одна нога сгибается, таз уходит к ней и вниз, другая нога прямая.
 * Колени — обратная кинематика в плоскости кадра (длины бедра и голени сохраняются).
 */
export function sideLungeFrame(p: SideLungeParams, t: number, noise: () => number = () => 0): PoseFrame {
  const aspect = p.aspect ?? 4 / 3;
  const H = p.height ?? 0.75;
  const footY = p.footY ?? 0.92;
  const M = 1.7 / H;
  const thigh = 0.245 * H;
  const shin = 0.25 * H;
  const torso = 0.3 * H;
  const hipW = 0.1 * H;
  const shoulderW = 0.22 * H;
  const cx = 0.5 * aspect;
  const half = (p.stance ?? 0.3) * H;
  const d = Math.max(0, Math.min(1, p.depth));
  // Человек лицом к камере: его левая сторона — справа на картинке (+x).
  const bent = p.side === 'left' ? 1 : -1;
  const standY = footY - Math.sqrt(Math.max(0, (thigh + shin) ** 2 - (half - hipW / 2) ** 2));
  const hipY = standY + (footY - 1.04 * shin - standY) * d;
  const hipX = cx + bent * 0.18 * H * d;
  const image: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, v: 0.95 }));
  const world: Vec3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const put = (i: number, x: number, y: number, z = 0) => {
    image[i] = { x: x / aspect + noise(), y: y + noise(), z: 0, v: 0.95 };
    world[i] = { x: (x - cx) * M, y: (y - hipY) * M, z: z * M };
  };
  for (const side of [1, -1] as const) {
    const s =
      side > 0
        ? { ankle: 27, knee: 25, hip: 23, heel: 29, foot: 31 }
        : { ankle: 28, knee: 26, hip: 24, heel: 30, foot: 32 };
    const hip = { x: hipX + (side * hipW) / 2, y: hipY };
    const ankle = { x: cx + side * half, y: footY };
    let knee = kneeIK(hip, ankle, thigh, shin, side);
    if (side === bent && p.kneeIn) knee = { x: knee.x - side * p.kneeIn * 0.08 * H, y: knee.y };
    put(s.ankle, ankle.x, ankle.y);
    put(s.heel, ankle.x, ankle.y + 0.015 * H, 0.04 * H);
    put(s.foot, ankle.x + side * 0.01 * H, ankle.y + 0.02 * H, -0.12 * H);
    put(s.knee, knee.x, knee.y, side === bent ? -0.02 * H : 0);
    put(s.hip, hip.x, hip.y);
  }
  // Корпус над серединой таза, руки сложены перед грудью.
  const lean = ((p.lean ?? 0) * Math.PI) / 180;
  const shY = hipY - torso * Math.cos(lean);
  const shZ = -torso * Math.sin(lean);
  put(0, hipX, shY - 0.1 * H, shZ - 0.03 * H);
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    put(i, hipX + (i % 2 ? 1 : -1) * 0.02 * H, shY - 0.11 * H, shZ);
  for (const [sh, el, wr, sign] of [
    [11, 13, 15, 1],
    [12, 14, 16, -1],
  ] as const) {
    const sx = hipX + (sign * shoulderW) / 2;
    put(sh, sx, shY, shZ);
    put(el, sx + sign * 0.02 * H, shY + 0.13 * H, shZ - 0.06 * H);
    put(wr, hipX + sign * 0.02 * H, shY + 0.08 * H, shZ - 0.12 * H);
    for (const i of sign > 0 ? [17, 19, 21] : [18, 20, 22])
      put(i, hipX + sign * 0.02 * H, shY + 0.1 * H, shZ - 0.12 * H);
  }
  return { t, aspect, image, world };
}

export interface FloorParams {
  /** Глубина отжимания: 0 — руки прямые (упор лёжа), 1 — грудь у пола (плечи на высоте предплечья). */
  down: number;
  /** Планка на предплечьях: локти на полу под плечами, кисти ближе к камере. */
  forearms?: boolean;
  /** Перекос: правое плечо человека ниже левого на столько ширин плеч. */
  tilt?: number;
  /** Локти дальше наружу на столько ширин плеч («буквой Т»). */
  elbowsOut?: number;
  aspect?: number;
  height?: number;
  floorY?: number;
}

/**
 * Упор лёжа лицом к камере, камера на полу перед человеком (отжимания, планка; E-31). Так снимают дуэли на
 * отжиманиях: кисти на полу внизу кадра, плечи над ними, корпус и ноги уходят от камеры и сжаты перспективой
 * (таз чуть ниже плеч, колени и стопы почти не видны — у MediaPipe видимость 0,1–0,4). Внизу отжимания плечи
 * опускаются на ~0,8 ширины плеч, угол в локте на картинке — ~110° (локти уходят назад и в стороны):
 * так на реальной записи RepChamp «Push Up Battle».
 */
export function floorFrame(p: FloorParams, t: number, noise: () => number = () => 0): PoseFrame {
  const aspect = p.aspect ?? 4 / 3;
  const H = p.height ?? 0.75;
  const floorY = p.floorY ?? 0.9;
  const cx = 0.5 * aspect;
  const image: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, v: 0.9 }));
  const world: Vec3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const put = (i: number, x: number, y: number, z: number, v = 0.9) => {
    image[i] = { x: x / aspect + noise(), y: y + noise(), z: 0, v };
    world[i] = { x: (x - cx) / H, y: y / H, z: z / H };
  };
  const down = Math.max(0, p.down);
  const halfShoulder = 0.11 * H;
  // Плечи: на прямых руках — на высоте руки, внизу — на высоте предплечья; планка на локтях — плечо над локтем.
  const shY = p.forearms ? floorY - 0.17 * H : floorY - (0.33 - 0.18 * down) * H;
  // Угол в локте на картинке: 175° на прямых руках → 110° внизу.
  const elbowDeg = Math.max(60, 175 - 65 * down);
  for (const side of [1, -1] as const) {
    const s =
      side > 0
        ? { sh: 11, el: 13, wr: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31, hand: [17, 19, 21] }
        : { sh: 12, el: 14, wr: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32, hand: [18, 20, 22] };
    const shoulder = {
      x: cx + side * halfShoulder,
      y: shY + (side < 0 ? (p.tilt ?? 0) * 2 * halfShoulder : 0),
    };
    let elbow: { x: number; y: number };
    let wrist: { x: number; y: number };
    if (p.forearms) {
      elbow = { x: shoulder.x, y: floorY - 0.01 * H };
      wrist = { x: cx + side * 0.05 * H, y: floorY + 0.04 * H };
    } else {
      wrist = { x: cx + side * 0.14 * H, y: floorY - 0.01 * H };
      // Равные плечо и предплечье на картинке: длина из угла в локте, локоть — наружу.
      const d = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y);
      const seg = d / (2 * Math.sin((elbowDeg * Math.PI) / 360));
      elbow = kneeIK(shoulder, wrist, seg, seg, side);
    }
    elbow = { x: elbow.x + side * (p.elbowsOut ?? 0) * 2 * halfShoulder, y: elbow.y };
    put(s.sh, shoulder.x, shoulder.y, 0);
    put(s.el, elbow.x, elbow.y, 0.05 * H);
    put(s.wr, wrist.x, wrist.y, -0.02 * H);
    for (const i of s.hand) put(i, wrist.x, wrist.y + 0.01 * H, -0.03 * H);
    put(s.hip, cx + side * 0.06 * H, shY + 0.12 * H, 0.35 * H, 0.9);
    put(s.knee, cx + side * 0.05 * H, shY + 0.2 * H, 0.6 * H, 0.2);
    put(s.ankle, cx + side * 0.05 * H, shY + 0.26 * H, 0.85 * H, 0.2);
    put(s.heel, cx + side * 0.05 * H, shY + 0.25 * H, 0.87 * H, 0.1);
    put(s.toe, cx + side * 0.05 * H, shY + 0.27 * H, 0.82 * H, 0.1);
  }
  put(0, cx, shY - 0.08 * H, -0.08 * H);
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    put(i, cx + (i % 2 ? 1 : -1) * 0.02 * H, shY - 0.09 * H, -0.08 * H);
  return { t, aspect, image, world };
}

/**
 * Упор лёжа лицом к камере (планка в бёрпи): плечи над кистями на высоте руки над полом, таз ниже и дальше,
 * стопы на полу позади. В кадре человек «сжат» по вертикали — так бёрпи анфас и видит MediaPipe.
 */
export function frontPlankFrame(
  p: { aspect?: number; height?: number; footY?: number },
  t: number,
): PoseFrame {
  const aspect = p.aspect ?? 4 / 3;
  const H = p.height ?? 0.75;
  const floorY = p.footY ?? 0.92;
  const cx = 0.5 * aspect;
  const image: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, v: 0.9 }));
  const world: Vec3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const put = (i: number, x: number, y: number, z: number, v = 0.9) => {
    image[i] = { x: x / aspect, y, z: 0, v };
    world[i] = { x: (x - cx) / H, y: y / H, z: z / H };
  };
  const shY = floorY - 0.3 * H;
  for (const side of [1, -1] as const) {
    const s =
      side > 0
        ? { sh: 11, el: 13, wr: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31, hand: [17, 19, 21] }
        : { sh: 12, el: 14, wr: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32, hand: [18, 20, 22] };
    put(s.sh, cx + side * 0.11 * H, shY, 0);
    put(s.el, cx + side * 0.12 * H, shY + 0.15 * H, 0);
    put(s.wr, cx + side * 0.12 * H, floorY - 0.01 * H, 0);
    for (const i of s.hand) put(i, cx + side * 0.12 * H, floorY, -0.02 * H);
    put(s.hip, cx + side * 0.05 * H, floorY - 0.19 * H, 0.3 * H, 0.8);
    put(s.knee, cx + side * 0.05 * H, floorY - 0.1 * H, 0.55 * H, 0.7);
    put(s.ankle, cx + side * 0.06 * H, floorY - 0.03 * H, 0.8 * H, 0.7);
    put(s.heel, cx + side * 0.06 * H, floorY - 0.05 * H, 0.83 * H, 0.6);
    put(s.toe, cx + side * 0.06 * H, floorY, 0.76 * H, 0.6);
  }
  put(0, cx, shY - 0.06 * H, -0.08 * H);
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    put(i, cx + (i % 2 ? 1 : -1) * 0.02 * H, shY - 0.07 * H, -0.08 * H);
  return { t, aspect, image, world };
}

/** Смесь двух поз (для анимации переходов): k = 0 — a, 1 — b. */
export function blendFrames(a: PoseFrame, b: PoseFrame, k: number, t: number): PoseFrame {
  const mix = (u: number, v: number) => u + (v - u) * k;
  return {
    t,
    aspect: a.aspect,
    image: a.image.map((p, i) => {
      const q = b.image[i] as Landmark;
      return { x: mix(p.x, q.x), y: mix(p.y, q.y), z: mix(p.z, q.z), v: mix(p.v, q.v) };
    }),
    world:
      a.world && b.world
        ? a.world.map((p, i) => {
            const q = (b.world as Vec3[])[i] as Vec3;
            return { x: mix(p.x, q.x), y: mix(p.y, q.y), z: mix(p.z, q.z) };
          })
        : null,
  };
}
