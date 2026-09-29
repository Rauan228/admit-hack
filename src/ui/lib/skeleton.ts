// Рисование скелета MediaPipe Pose на canvas: кадр камеры вписан в экран как object-fit: cover и отражён,
// поэтому точки пересчитываются тем же преобразованием, что и видео — скелет лежит ровно на теле.

import type { Arrow, Landmark } from '../../engine/types';

/** Кости: плечи, руки, корпус, ноги, стопы. Лицо рисуем кругом головы, а не точками. */
export const BONES: readonly [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [15, 19],
  [16, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [27, 31],
  [28, 30],
  [30, 32],
  [28, 32],
];

const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
const MIN_VISIBILITY = 0.5;

export interface View {
  W: number;
  H: number;
  ox: number;
  oy: number;
  dw: number;
  dh: number;
  mirror: boolean;
}

/** Преобразование кадра srcW×srcH в экран W×H по правилу cover. */
export function coverView(W: number, H: number, srcW: number, srcH: number, mirror = true): View {
  const scale = Math.max(W / srcW, H / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { W, H, ox: (W - dw) / 2, oy: (H - dh) / 2, dw, dh, mirror };
}

/** Преобразование contain: для «призрака» в карточке, где фигура не должна обрезаться. */
export function containView(W: number, H: number, srcW: number, srcH: number, mirror = false): View {
  const scale = Math.min(W / srcW, H / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { W, H, ox: (W - dw) / 2, oy: (H - dh) / 2, dw, dh, mirror };
}

export function toScreen(v: View, p: Landmark): { x: number; y: number } {
  const x = v.ox + p.x * v.dw;
  return { x: v.mirror ? v.W - x : x, y: v.oy + p.y * v.dh };
}

export interface SkeletonStyle {
  color: string;
  errorColor?: string;
  errorJoints?: ReadonlySet<number>;
  alpha?: number;
  width?: number;
  glow?: string | null;
  /** Пульсация подсветки ошибки 0..1. */
  pulse?: number;
}

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  v: View,
  lms: Landmark[],
  s: SkeletonStyle,
): void {
  const width = s.width ?? Math.max(4, v.dh * 0.009);
  const errors = s.errorJoints ?? new Set<number>();
  const errorColor = s.errorColor ?? '#ef4444';
  ctx.save();
  ctx.globalAlpha = s.alpha ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.glow) {
    ctx.shadowColor = s.glow;
    ctx.shadowBlur = width * 4;
  }

  for (const [a, b] of BONES) {
    const p = lms[a];
    const q = lms[b];
    if (!p || !q || p.v < MIN_VISIBILITY || q.v < MIN_VISIBILITY) continue;
    const P = toScreen(v, p);
    const Q = toScreen(v, q);
    const bad = errors.has(a) && errors.has(b);
    ctx.strokeStyle = bad ? errorColor : s.color;
    ctx.lineWidth = bad ? width * 1.5 : width;
    ctx.beginPath();
    ctx.moveTo(P.x, P.y);
    ctx.lineTo(Q.x, Q.y);
    ctx.stroke();
  }

  // Голова — круг вокруг носа, радиус от ширины плеч.
  const nose = lms[0];
  const ls = lms[11];
  const rs = lms[12];
  if (nose && ls && rs && nose.v >= MIN_VISIBILITY) {
    const N = toScreen(v, nose);
    const L = toScreen(v, ls);
    const R = toScreen(v, rs);
    const r = Math.max(10, Math.hypot(L.x - R.x, L.y - R.y) * 0.32);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(N.x, N.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  for (const i of JOINTS) {
    const p = lms[i];
    if (!p || p.v < MIN_VISIBILITY) continue;
    const P = toScreen(v, p);
    const bad = errors.has(i);
    const r = bad ? width * (1.6 + (s.pulse ?? 0) * 0.9) : width * 0.95;
    if (bad) {
      ctx.fillStyle = errorColor;
      ctx.globalAlpha = (s.alpha ?? 1) * 0.28;
      ctx.beginPath();
      ctx.arc(P.x, P.y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = s.alpha ?? 1;
    }
    ctx.fillStyle = bad ? errorColor : '#f8fafc';
    ctx.beginPath();
    ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Центр масс видимых суставов (для стрелки подсказки). */
export function jointsCenter(
  v: View,
  lms: Landmark[],
  joints: Iterable<number>,
): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const i of joints) {
    const p = lms[i];
    if (!p || p.v < MIN_VISIBILITY) continue;
    const P = toScreen(v, p);
    x += P.x;
    y += P.y;
    n += 1;
  }
  return n ? { x: x / n, y: y / n } : null;
}

/** Середина таза на экране: от неё считаем «наружу» и «внутрь». */
function bodyCenterX(v: View, lms: Landmark[]): number | null {
  const l = lms[23];
  const r = lms[24];
  if (!l || !r) return null;
  return (toScreen(v, l).x + toScreen(v, r).x) / 2;
}

/**
 * Стрелки «куда двигать сустав». up/down — одна стрелка над группой суставов;
 * out/in — по стрелке у каждого сустава, от середины тела или к ней. left/right — в координатах экрана.
 */
export function drawHintArrows(
  ctx: CanvasRenderingContext2D,
  v: View,
  lms: Landmark[],
  joints: ReadonlySet<number>,
  arrow: Arrow,
  color: string,
  t: number,
): void {
  const size = Math.max(26, v.dh * 0.055);
  const bounce = Math.sin(t / 160) * size * 0.18;
  if (arrow === 'out' || arrow === 'in') {
    const cx = bodyCenterX(v, lms);
    for (const i of joints) {
      const p = lms[i];
      if (!p || p.v < MIN_VISIBILITY || cx === null) continue;
      const P = toScreen(v, p);
      const side = Math.sign(P.x - cx) || 1; // с какой стороны тела сустав
      const gap = size * 0.7 + Math.abs(bounce);
      if (arrow === 'out') {
        // Стрелка стоит снаружи сустава и смотрит от тела.
        arrowShape(ctx, P.x + side * gap, P.y, side, 0, size, color);
      } else {
        // Стрелка стоит ещё дальше снаружи и смотрит на сустав, к середине тела.
        arrowShape(ctx, P.x + side * (gap + size * 1.15), P.y, -side, 0, size, color);
      }
    }
    return;
  }
  const c = jointsCenter(v, lms, joints);
  if (!c) return;
  const DIRS: Record<'up' | 'down' | 'left' | 'right', [number, number]> = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
  };
  const [dx, dy] = DIRS[arrow];
  const gap = size * 1.4;
  arrowShape(ctx, c.x + dx * (gap + bounce), c.y + dy * (gap + bounce), dx, dy, size, color);
}

/** Толстая стрелка с тенью; (x, y) — основание, (dx, dy) — направление. */
function arrowShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 12;
  const L = size;
  const T = size * 0.34;
  ctx.beginPath();
  ctx.moveTo(0, -T / 2);
  ctx.lineTo(L * 0.55, -T / 2);
  ctx.lineTo(L * 0.55, -T * 1.25);
  ctx.lineTo(L * 1.15, 0);
  ctx.lineTo(L * 0.55, T * 1.25);
  ctx.lineTo(L * 0.55, T / 2);
  ctx.lineTo(0, T / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
