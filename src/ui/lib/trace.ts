// Тонкий трекинг-скелет поверх камеры: линии ~2% ширины плеч, точки суставов, лёгкий контур торса.
// Точки сглаживаются фильтром One Euro при отрисовке (как в vladmandic/human): дрожание на месте убирается,
// быстрые движения не отстают. Ошибка — только проблемные сегменты толще и красные, суставы пульсируют.

import type { Landmark } from '../../engine/types';
import { toScreen, type View } from './skeleton';

const MIN_V = 0.5;
type Pt = { x: number; y: number };

const BONES: [number, number][] = [
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 32],
];
const TORSO = [11, 12, 24, 23];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export interface TraceStyle {
  color: string;
  /** Цвет свечения (null — без свечения, телефон). */
  glow: string | null;
  alpha: number;
  errorJoints?: ReadonlySet<number>;
  errorColor: string;
  /** 0..1 — пульсация колец ошибки. */
  pulse: number;
}

// ——— One Euro filter ———

class OneEuro {
  private x: number | null = null;
  private dx = 0;
  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(v: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      this.x = v;
      return v;
    }
    const d = (v - this.x) / dt;
    this.dx += OneEuro.alpha(1, dt) * (d - this.dx);
    const a = OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    this.x += a * (v - this.x);
    return this.x;
  }
}

/** Сглаживание 33 точек при отрисовке. Координаты — доли кадра, поэтому параметры не зависят от экрана. */
export class LandmarkSmoother {
  private fx: OneEuro[] = [];
  private fy: OneEuro[] = [];
  private last = 0;
  private out: Landmark[] = [];

  smooth(lms: Landmark[], now: number): Landmark[] {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.fx.length !== lms.length) {
      this.fx = lms.map(() => new OneEuro(2.2, 9));
      this.fy = lms.map(() => new OneEuro(2.2, 9));
    }
    this.out = lms.map((p, i) => ({ ...p, x: this.fx[i]!.filter(p.x, dt), y: this.fy[i]!.filter(p.y, dt) }));
    return this.out;
  }
}

// ——— Отрисовка ———

export function drawTrace(ctx: CanvasRenderingContext2D, v: View, lms: Landmark[], s: TraceStyle): void {
  const P = (i: number): Pt | null => {
    const p = lms[i];
    return p && p.v >= MIN_V ? toScreen(v, p) : null;
  };
  const ls = P(11);
  const rs = P(12);
  const lh = P(23);
  const rh = P(24);
  const sw =
    ls && rs
      ? Math.hypot(ls.x - rs.x, ls.y - rs.y)
      : lh && rh
        ? Math.hypot(lh.x - rh.x, lh.y - rh.y) * 1.35
        : 0;
  if (sw < 6) return;

  const errors = s.errorJoints ?? new Set<number>();
  const w = Math.min(4, Math.max(1.5, sw * 0.022));

  ctx.save();
  ctx.globalAlpha = s.alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Торс: тонкий контур и едва заметная заливка.
  const torso = TORSO.map(P);
  if (torso.every(Boolean)) {
    ctx.beginPath();
    torso.forEach((p, i) => (i ? ctx.lineTo(p!.x, p!.y) : ctx.moveTo(p!.x, p!.y)));
    ctx.closePath();
    ctx.fillStyle = withAlpha(s.color, 0.07);
    ctx.fill();
    ctx.strokeStyle = withAlpha(s.color, 0.75);
    ctx.lineWidth = w;
    ctx.stroke();
  }

  // Голова: кольцо вокруг середины ушей (или носа) и тонкая шея.
  const le = P(7);
  const re = P(8);
  const nose = P(0);
  const head = le && re ? { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 } : nose;
  if (head && ls && rs) {
    const neck = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const r = sw * 0.2;
    const dx = head.x - neck.x;
    const dy = head.y - neck.y;
    const len = Math.hypot(dx, dy) || 1;
    ctx.strokeStyle = withAlpha(s.color, 0.75);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(neck.x, neck.y);
    ctx.lineTo(head.x - (dx / len) * r, head.y - (dy / len) * r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Кости: сначала свечение (один проход), потом чёткая линия.
  const drawBones = (bad: boolean) => {
    ctx.beginPath();
    for (const [a, b] of BONES) {
      if ((errors.has(a) || errors.has(b)) !== bad) continue;
      const A = P(a);
      const B = P(b);
      if (!A || !B) continue;
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
    }
  };
  if (s.glow) {
    ctx.shadowColor = s.glow;
    ctx.shadowBlur = 10;
  }
  ctx.strokeStyle = s.color;
  ctx.lineWidth = w;
  drawBones(false);
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (errors.size) {
    ctx.strokeStyle = s.errorColor;
    ctx.lineWidth = w * 2;
    ctx.shadowColor = s.errorColor;
    ctx.shadowBlur = s.glow ? 12 : 0;
    drawBones(true);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Суставы: белая точка в цветном кольце.
  const r = Math.min(5.5, Math.max(2.5, sw * 0.028));
  for (const i of JOINTS) {
    const p = P(i);
    if (!p || errors.has(i)) continue;
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1, w * 0.7);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Ошибки: пульсирующее кольцо и точка.
  for (const i of errors) {
    const p = P(i);
    if (!p) continue;
    ctx.strokeStyle = s.errorColor;
    ctx.lineWidth = Math.max(1.5, w);
    ctx.globalAlpha = s.alpha * (1 - s.pulse * 0.6);
    ctx.beginPath();
    ctx.arc(p.x, p.y, sw * (0.14 + s.pulse * 0.1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = s.errorColor;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function withAlpha(color: string, a: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  return color;
}
