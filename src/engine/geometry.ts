// Геометрия позы: углы, расстояния, середины, видимость.
//
// Главная ловушка: MediaPipe отдаёт x в долях ШИРИНЫ кадра, а y — в долях ВЫСОТЫ.
// В кадре 640×480 единица по x в 1,33 раза длиннее единицы по y, и углы без поправки врут
// на десятки градусов. Поэтому вся 2D-геометрия идёт в «плоскости» с поправкой на аспект:
// x' = x · (ширина / высота), y' = y. Единица длины — высота кадра.

import type { HandSample } from './hands';
import type { Landmark, Side } from './types';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Кадр позы внутри движка: точки уже сглажены, аспект известен. */
export interface PoseFrame {
  /** Время кадра, мс. */
  t: number;
  /** Ширина / высота видео: 4/3 на ноутбуке, 3/4 на телефоне в портрете. */
  aspect: number;
  /** 33 нормализованные точки MediaPipe (x слева направо по исходной картинке, y сверху вниз). */
  image: Landmark[];
  /** 33 точки в метрах с началом между бёдер (worldLandmarks) или null, если их нет. */
  world: Vec3[] | null;
  /**
   * Кисти (hands.ts, E-36): кулак или ладонь и когда это измерено — только для упражнений с hands: true,
   * только пока идёт движение, и может отставать на кадр. Нет — кисти не проверялись.
   */
  hands?: Partial<Record<Side, HandSample>>;
  /**
   * Перекладина у кистей по пикселям кадра (bar.ts) — только для упражнений на турнике.
   * undefined — не искали; null — искали, линии нет.
   */
  bar?: { y: number; score: number } | null;
}

export const RAD_TO_DEG = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Точка в плоскости с поправкой на аспект. */
export function toPlane(p: Landmark, aspect: number): Vec2 {
  return { x: p.x * aspect, y: p.y };
}

/** Точка кадра i в плоскости с поправкой на аспект. */
export function pt(frame: PoseFrame, i: number): Vec2 {
  const p = frame.image[i];
  return p ? toPlane(p, frame.aspect) : { x: NaN, y: NaN };
}

/** Мировая точка i (метры) или null. */
export function wpt(frame: PoseFrame, i: number): Vec3 | null {
  return frame.world?.[i] ?? null;
}

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function mid2(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function mid3(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/** Угол в точке b между лучами b→a и b→c, градусы 0..180. NaN, если луч нулевой длины. */
export function angle2(a: Vec2, b: Vec2, c: Vec2): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const nu = Math.hypot(ux, uy);
  const nv = Math.hypot(vx, vy);
  if (nu === 0 || nv === 0) return NaN;
  return Math.acos(clamp((ux * vx + uy * vy) / (nu * nv), -1, 1)) * RAD_TO_DEG;
}

/** То же в 3D (мировые координаты). */
export function angle3(a: Vec3, b: Vec3, c: Vec3): number {
  const u = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const nu = Math.hypot(u.x, u.y, u.z);
  const nv = Math.hypot(v.x, v.y, v.z);
  if (nu === 0 || nv === 0) return NaN;
  return Math.acos(clamp((u.x * v.x + u.y * v.y + u.z * v.z) / (nu * nv), -1, 1)) * RAD_TO_DEG;
}

/**
 * Угол вектора from→to от вертикали вверх, градусы 0..180.
 * 0 — строго вверх (корпус прямой), 90 — горизонтально, 180 — вниз.
 */
export function angleFromVertical(from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const n = Math.hypot(dx, dy);
  if (n === 0) return NaN;
  // Вверх на картинке — это минус по y.
  return Math.acos(clamp(-dy / n, -1, 1)) * RAD_TO_DEG;
}

/**
 * Наклон по укорочению: если отрезок стоя имел вертикальную длину `upright`, а сейчас — `now`,
 * то он отклонился от вертикали на acos(now / upright). Работает и анфас (наклон на камеру
 * виден только как укорочение), и сбоку. NaN, если опоры нет.
 */
export function tiltFromForeshortening(now: number, upright: number): number {
  if (!(upright > 0) || !Number.isFinite(now)) return NaN;
  return Math.acos(clamp(now / upright, -1, 1)) * RAD_TO_DEG;
}

/** Точка видна: достаточная уверенность модели и лежит в кадре (с допуском margin). */
export function isVisible(p: Landmark | undefined, minVisibility = 0.5, margin = 0): p is Landmark {
  return (
    !!p && p.v >= minVisibility && p.x >= -margin && p.x <= 1 + margin && p.y >= -margin && p.y <= 1 + margin
  );
}

/** Все точки из списка видны. */
export function allVisible(frame: PoseFrame, joints: readonly number[], minVisibility = 0.5): boolean {
  return joints.every((i) => isVisible(frame.image[i], minVisibility));
}

/** Средняя видимость точек из списка (0..1). */
export function meanVisibility(frame: PoseFrame, joints: readonly number[]): number {
  if (joints.length === 0) return 0;
  let sum = 0;
  for (const i of joints) sum += frame.image[i]?.v ?? 0;
  return sum / joints.length;
}

/**
 * Масштаб тела: длина корпуса (середина плеч → середина таза) в плоскости.
 * Нужна, чтобы пороги не зависели от того, насколько близко человек к камере.
 */
export function torsoLength(frame: PoseFrame): number {
  const sh = mid2(pt(frame, 11), pt(frame, 12));
  const hip = mid2(pt(frame, 23), pt(frame, 24));
  return dist2(sh, hip);
}

/**
 * Перевод точки из координат картинки в координаты экрана, который показывает видео зеркально:
 * человек поднимает правую руку — курсор уходит вправо, как в зеркале.
 */
export function mirrorX(x: number): number {
  return 1 - x;
}
