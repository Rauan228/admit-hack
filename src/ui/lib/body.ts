// Объёмная фигура вместо «палочек»: торс-полигон, конечности-капсулы с контуром, голова, суставы-точки.
// Толщина считается от ширины плеч на экране, поэтому фигура одинаково выглядит вблизи и вдали.
// Дальняя от камеры сторона (по z MediaPipe) рисуется первой и темнее — фигура читается объёмной.

import type { Landmark } from '../../engine/types';
import { toScreen, type View } from './skeleton';

const MIN_V = 0.5;

type Pt = { x: number; y: number };

/** Сегменты конечностей: [от, до, толщина в долях ширины плеч]. */
const LIMBS: { side: 'l' | 'r'; a: number; b: number; w: number }[] = [
  { side: 'l', a: 23, b: 25, w: 0.34 },
  { side: 'l', a: 25, b: 27, w: 0.26 },
  { side: 'l', a: 27, b: 31, w: 0.15 },
  { side: 'l', a: 11, b: 13, w: 0.25 },
  { side: 'l', a: 13, b: 15, w: 0.19 },
  { side: 'r', a: 24, b: 26, w: 0.34 },
  { side: 'r', a: 26, b: 28, w: 0.26 },
  { side: 'r', a: 28, b: 32, w: 0.15 },
  { side: 'r', a: 12, b: 14, w: 0.25 },
  { side: 'r', a: 14, b: 16, w: 0.19 },
];

const JOINT_DOTS = [13, 14, 15, 16, 25, 26, 27, 28];

export interface BodyStyle {
  /** Заливка тела. */
  fill: string;
  /** Контур и «кость» внутри. */
  line: string;
  /** Цвет свечения контура (null — без свечения). */
  glow?: string | null;
  alpha?: number;
  /** Толщина контура в px. */
  outline?: number;
  /** Точки суставов (для живой фигуры — ощущение трекинга). */
  dots?: boolean;
  /** Белая «кость» по центру конечностей. */
  core?: boolean;
  errorJoints?: ReadonlySet<number>;
  errorColor?: string;
  /** 0..1 — пульсация подсветки ошибки. */
  pulse?: number;
}

export function drawBody(ctx: CanvasRenderingContext2D, v: View, lms: Landmark[], s: BodyStyle): void {
  const P = (i: number): Pt | null => {
    const p = lms[i];
    return p && p.v >= MIN_V ? toScreen(v, p) : null;
  };
  const ls = P(11);
  const rs = P(12);
  const lh = P(23);
  const rh = P(24);
  const sw = ls && rs ? dist(ls, rs) : lh && rh ? dist(lh, rh) * 1.35 : 0;
  if (sw < 6) return;

  const errors = s.errorJoints ?? new Set<number>();
  const errColor = s.errorColor ?? '#ef4444';
  const outline = s.outline ?? Math.max(2, sw * 0.03);
  const alpha = s.alpha ?? 1;
  const isBad = (a: number, b: number) => errors.has(a) || errors.has(b);

  // Какая сторона дальше от камеры: у MediaPipe меньшее z — ближе.
  const zOf = (side: 'l' | 'r') => {
    const ids = side === 'l' ? [11, 23, 25] : [12, 24, 26];
    return ids.reduce((acc, i) => acc + (lms[i]?.z ?? 0), 0);
  };
  const far: 'l' | 'r' = zOf('l') > zOf('r') ? 'l' : 'r';

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const limb = (a: number, b: number, w: number, dim: boolean) => {
    const A = P(a);
    const B = P(b);
    if (!A || !B) return;
    const bad = isBad(a, b);
    const width = Math.max(4, sw * w);
    const line = bad ? errColor : s.line;
    // Контур: та же капсула шире, со свечением.
    ctx.shadowColor = bad ? errColor : (s.glow ?? 'transparent');
    ctx.shadowBlur = s.glow || bad ? outline * 5 : 0;
    ctx.strokeStyle = line;
    ctx.lineWidth = width + outline * 2;
    seg(ctx, A, B);
    ctx.shadowBlur = 0;
    // Заливка.
    ctx.strokeStyle = bad ? withAlpha(errColor, 0.55) : s.fill;
    ctx.lineWidth = width;
    seg(ctx, A, B);
    if (dim) {
      ctx.strokeStyle = 'rgba(5, 8, 16, 0.32)';
      seg(ctx, A, B);
    }
    if (s.core) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = Math.max(1.5, width * 0.1);
      seg(ctx, A, B);
    }
  };

  // 1. Дальние конечности — под торсом.
  for (const l of LIMBS) if (l.side === far) limb(l.a, l.b, l.w, true);

  // 2. Торс: четырёхугольник плечи–таз со скруглёнными углами.
  if (ls && rs && lh && rh) {
    // Торс красим, только если ошибка про корпус (и плечи, и таз) — иначе краснеют конечности.
    const bad = (errors.has(11) || errors.has(12)) && (errors.has(23) || errors.has(24));
    ctx.beginPath();
    ctx.moveTo(ls.x, ls.y);
    ctx.lineTo(rs.x, rs.y);
    ctx.lineTo(rh.x, rh.y);
    ctx.lineTo(lh.x, lh.y);
    ctx.closePath();
    ctx.shadowColor = bad ? errColor : (s.glow ?? 'transparent');
    ctx.shadowBlur = s.glow || bad ? outline * 5 : 0;
    ctx.strokeStyle = bad ? errColor : s.line;
    ctx.lineWidth = sw * 0.16 + outline * 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = bad ? withAlpha(errColor, 0.55) : s.fill;
    ctx.lineWidth = sw * 0.16;
    ctx.stroke();
    ctx.fillStyle = bad ? withAlpha(errColor, 0.55) : s.fill;
    ctx.fill();

    // Шея.
    const neckBase = mid(ls, rs);
    const head = headCenter(P, neckBase, sw);
    if (head) {
      ctx.strokeStyle = s.line;
      ctx.lineWidth = sw * 0.17 + outline * 2;
      seg(ctx, neckBase, lerp(neckBase, head, 0.55));
      ctx.strokeStyle = s.fill;
      ctx.lineWidth = sw * 0.17;
      seg(ctx, neckBase, lerp(neckBase, head, 0.55));

      // Голова.
      const r = sw * 0.3;
      ctx.beginPath();
      ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
      ctx.shadowColor = s.glow ?? 'transparent';
      ctx.shadowBlur = s.glow ? outline * 5 : 0;
      ctx.fillStyle = s.line;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(head.x, head.y, Math.max(2, r - outline), 0, Math.PI * 2);
      ctx.fillStyle = s.fill;
      ctx.fill();
    }
  }

  // 3. Ближние конечности — поверх торса.
  for (const l of LIMBS) if (l.side !== far) limb(l.a, l.b, l.w, false);

  // 4. Суставы: точки трекинга и пульсирующие кольца ошибок.
  for (const i of JOINT_DOTS) {
    const p = P(i);
    if (!p || errors.has(i) || !s.dots) continue;
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2.5, sw * 0.045), 0, Math.PI * 2);
    ctx.fill();
  }
  const pulse = s.pulse ?? 0;
  for (const i of errors) {
    const p = P(i);
    if (!p) continue;
    const r = sw * (0.16 + pulse * 0.1);
    ctx.strokeStyle = errColor;
    ctx.lineWidth = Math.max(2, sw * 0.035);
    ctx.globalAlpha = alpha * (1 - pulse * 0.6);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = errColor;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(4, sw * 0.07), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Центр головы: середина ушей, если видны, иначе нос, приподнятый над плечами. */
function headCenter(P: (i: number) => Pt | null, neck: Pt, sw: number): Pt | null {
  const le = P(7);
  const re = P(8);
  const nose = P(0);
  if (le && re) return mid(le, re);
  if (nose) return { x: nose.x, y: nose.y - sw * 0.05 };
  return { x: neck.x, y: neck.y - sw * 0.6 };
}

/** Центр масс тела на экране — отсюда летят частицы на повторе. */
export function bodyCenter(v: View, lms: Landmark[]): Pt | null {
  const pts = [11, 12, 23, 24]
    .map((i) => lms[i])
    .filter((p): p is Landmark => !!p && p.v >= MIN_V)
    .map((p) => toScreen(v, p));
  if (!pts.length) return null;
  return {
    x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
    y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
  };
}

function seg(ctx: CanvasRenderingContext2D, a: Pt, b: Pt): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
