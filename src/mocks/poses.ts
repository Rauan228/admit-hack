// Синтетический скелет для мок-движка: 33 точки MediaPipe без камеры.
// Простая 2D-кинематика: стопы стоят на «полу», таз опускается, руки считаются по углам.
// Координаты нормализованы (0..1), как у MediaPipe: x — слева направо, y — сверху вниз.

import type { Landmark } from '../engine/types';

export interface BodyParams {
  /** x таза, 0..1 */
  centerX: number;
  /** y стоп, 0..1 */
  groundY: number;
  /** полный рост в долях высоты кадра */
  height: number;
  /** 0 — стоя, 1 — глубокий присед (бедро ниже параллели) */
  squat: number;
  /** ширина стойки в долях роста */
  stance: number;
  /** наклон корпуса вперёд, градусы (визуально — сдвиг плеч) */
  lean: number;
  /** 0 — колени по линии носков, 1 — колени свалились внутрь */
  kneeIn: number;
  /** углы плеч от вертикали вниз: 0 — руки у тела, 90 — в стороны, 180 — над головой */
  armL: number;
  armR: number;
  /** сгиб локтя, градусы (0 — прямая рука) */
  elbowL: number;
  elbowR: number;
  /** сдвиг левой ноги вперёд для выпада, в долях роста (визуально — вниз-в сторону) */
  lungeFront: number;
  /** видимость точек 0..1 */
  visibility: number;
  /** видимость ног отдельно: для статуса partial ноги «обрезаны» кадром */
  legVisibility: number;
  /** подъём колена: 0 — нога на полу, 1 — колено на уровне таза (высокие колени, локоть к колену) */
  kneeLiftL: number;
  kneeLiftR: number;
}

export const STANDING: BodyParams = {
  centerX: 0.5,
  groundY: 0.94,
  height: 0.8,
  squat: 0,
  stance: 0.22,
  lean: 0,
  kneeIn: 0,
  armL: 12,
  armR: 12,
  elbowL: 8,
  elbowR: 8,
  lungeFront: 0,
  visibility: 0.96,
  legVisibility: 0.95,
  kneeLiftL: 0,
  kneeLiftR: 0,
};

export function body(overrides: Partial<BodyParams> = {}): BodyParams {
  return { ...STANDING, ...overrides };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Линейная интерполяция параметров тела: из неё получается плавная анимация. */
export function lerpBody(a: BodyParams, b: BodyParams, t: number): BodyParams {
  const k = Math.min(1, Math.max(0, t));
  const out = {} as BodyParams;
  for (const key of Object.keys(STANDING) as (keyof BodyParams)[]) {
    out[key] = a[key] + (b[key] - a[key]) * k;
  }
  return out;
}

/** Плавное «туда-обратно» 0→1→0 для циклов упражнений. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

interface Pt {
  x: number;
  y: number;
  z?: number;
  v?: number;
}

/**
 * Строит 33 точки MediaPipe Pose.
 * Человек стоит лицом к камере, поэтому его левая сторона — справа на картинке (x больше).
 */
export function buildPose(p: BodyParams): Landmark[] {
  const H = p.height;
  const legLen = 0.48 * H;
  const torso = 0.3 * H;
  const shoulderW = 0.2 * H;
  const hipW = 0.14 * H;
  const upperArm = 0.16 * H;
  const forearm = 0.15 * H;
  const neck = 0.08 * H;

  // Присед: стопы на месте, таз уходит вниз.
  const hipY = p.groundY - legLen * (1 - 0.42 * p.squat);
  const hipX = p.centerX;
  // Наклон корпуса: плечи уезжают вперёд (вправо на картинке) и вниз.
  const leanX = Math.sin(rad(p.lean)) * torso;
  const leanY = Math.cos(rad(p.lean)) * torso;
  const shX = hipX + leanX * 0.6;
  const shY = hipY - leanY;

  const pts: Pt[] = new Array<Pt>(33);
  const set = (i: number, x: number, y: number, z = 0, v = p.visibility) => {
    pts[i] = { x, y, z, v };
  };

  // Голова и лицо.
  const noseY = shY - neck;
  set(0, shX, noseY);
  const eyeY = noseY - 0.012 * H;
  set(1, shX + 0.012 * H, eyeY);
  set(2, shX + 0.022 * H, eyeY);
  set(3, shX + 0.032 * H, eyeY);
  set(4, shX - 0.012 * H, eyeY);
  set(5, shX - 0.022 * H, eyeY);
  set(6, shX - 0.032 * H, eyeY);
  set(7, shX + 0.045 * H, noseY + 0.005 * H);
  set(8, shX - 0.045 * H, noseY + 0.005 * H);
  set(9, shX + 0.018 * H, noseY + 0.025 * H);
  set(10, shX - 0.018 * H, noseY + 0.025 * H);

  // Плечи и таз: индекс 11/23 — левая сторона человека (справа на картинке).
  const sides: {
    sign: number;
    shoulder: number;
    elbow: number;
    wrist: number;
    pinky: number;
    index: number;
    thumb: number;
    hip: number;
    knee: number;
    ankle: number;
    heel: number;
    foot: number;
    arm: number;
    elbowBend: number;
  }[] = [
    {
      sign: 1,
      shoulder: 11,
      elbow: 13,
      wrist: 15,
      pinky: 17,
      index: 19,
      thumb: 21,
      hip: 23,
      knee: 25,
      ankle: 27,
      heel: 29,
      foot: 31,
      arm: p.armL,
      elbowBend: p.elbowL,
    },
    {
      sign: -1,
      shoulder: 12,
      elbow: 14,
      wrist: 16,
      pinky: 18,
      index: 20,
      thumb: 22,
      hip: 24,
      knee: 26,
      ankle: 28,
      heel: 30,
      foot: 32,
      arm: p.armR,
      elbowBend: p.elbowR,
    },
  ];

  for (const s of sides) {
    const sx = shX + (s.sign * shoulderW) / 2;
    const sy = shY;
    set(s.shoulder, sx, sy);

    // Рука: угол от вертикали вниз, наружу от корпуса.
    const a = rad(s.arm);
    const ex = sx + s.sign * Math.sin(a) * upperArm;
    const ey = sy + Math.cos(a) * upperArm;
    set(s.elbow, ex, ey);
    const a2 = rad(s.arm + s.elbowBend);
    const wx = ex + s.sign * Math.sin(a2) * forearm;
    const wy = ey + Math.cos(a2) * forearm;
    set(s.wrist, wx, wy);
    const hand = 0.035 * H;
    set(s.pinky, wx + s.sign * Math.sin(a2) * hand, wy + Math.cos(a2) * hand);
    set(s.index, wx + s.sign * Math.sin(a2) * hand * 0.9, wy + Math.cos(a2) * hand * 1.1);
    set(s.thumb, wx + s.sign * Math.sin(a2) * hand * 0.6, wy + Math.cos(a2) * hand * 0.8);

    // Нога: стопа на полу, колено между тазом и стопой + выход вперёд в приседе.
    const hx = hipX + (s.sign * hipW) / 2;
    set(s.hip, hx, hipY);
    // Выпад: левая нога впереди (ниже и наружу), правая — сзади.
    const front = s.sign > 0 ? p.lungeFront : -p.lungeFront;
    const ax = hipX + ((s.sign * p.stance) / 2) * H + front * H * 0.35;
    const ay = p.groundY - (s.sign > 0 ? 0 : p.lungeFront * H * 0.12);
    const kx0 = (hx + ax) / 2 - s.sign * p.kneeIn * 0.06 * H;
    const ky0 = hipY + (ay - hipY) * 0.52 + p.squat * 0.01 * H;
    // Подъём колена: колено идёт к уровню таза, голень висит под ним, стопа отрывается от пола.
    const lift = s.sign > 0 ? p.kneeLiftL : p.kneeLiftR;
    const kx = kx0 + (hx - kx0) * lift;
    const ky = ky0 + (hipY + 0.03 * H - ky0) * lift;
    const fx = ax + (kx - ax) * lift;
    const fy = ay + (ky + (ay - ky0) - ay) * lift;
    set(s.ankle, fx, fy, 0, p.legVisibility);
    set(s.knee, kx, ky, 0, p.legVisibility);
    set(s.heel, fx - s.sign * 0.01 * H, fy + 0.015 * H, 0, p.legVisibility);
    set(s.foot, fx + s.sign * 0.02 * H, fy + 0.035 * H, 0, p.legVisibility);
  }

  return pts.map((pt) => ({ x: pt.x, y: pt.y, z: pt.z ?? 0, v: pt.v ?? p.visibility }));
}

/** Рука тянется к точке (x, y) экрана: нужно, чтобы скелет совпадал с курсором в меню. */
export function pointingBody(x: number, y: number, hand: 'left' | 'right'): BodyParams {
  // Чем выше и дальше в сторону курсор, тем сильнее поднята и отведена рука.
  const arm = 60 + (1 - y) * 110;
  const spread = hand === 'left' ? x - 0.5 : 0.5 - x;
  const elbow = -20 + spread * 60;
  return body(hand === 'left' ? { armL: arm, elbowL: elbow } : { armR: arm, elbowR: elbow });
}

export const BOTH_HANDS_UP: BodyParams = body({ armL: 165, armR: 165, elbowL: 5, elbowR: 5 });
