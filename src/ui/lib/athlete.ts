// Атлет-эталон: настоящее движение реальных людей (athleteMotion.json, собран scripts/build-ghost.mjs
// из 3D-точек MediaPipe в метрах) и 3D-рендер: поворот вокруг вертикали, части тела рисуются по глубине
// (дальние — первыми и темнее), конечности — сужающиеся капсулы, под ногами — тень.

import type { ExerciseId } from '../../engine/types';
import motionData from './athleteMotion.json';
import { capsulePath, mixHex, type Pt } from './shapes';

type V3 = { x: number; y: number; z: number };

interface Motion {
  durationMs: number;
  keep: number[];
  frames: number[][];
}

const MOTION = motionData as unknown as Record<ExerciseId, Motion>;

/** Кадры упражнения как массивы 33 точек (незаписанные — null). */
const cache = new Map<ExerciseId, (V3 | null)[][]>();
function framesOf(exercise: ExerciseId): (V3 | null)[][] {
  const hit = cache.get(exercise);
  if (hit) return hit;
  const m = MOTION[exercise];
  const frames = m.frames.map((flat) => {
    const pts: (V3 | null)[] = Array.from({ length: 33 }, () => null);
    m.keep.forEach((j, k) => {
      pts[j] = { x: flat[k * 3]!, y: flat[k * 3 + 1]!, z: flat[k * 3 + 2]! };
    });
    return pts;
  });
  cache.set(exercise, frames);
  return frames;
}

export function durationOf(exercise: ExerciseId): number {
  return MOTION[exercise].durationMs;
}

/** Поза в момент tMs (петля), линейная интерполяция между кадрами. */
export function athletePose(exercise: ExerciseId, tMs: number): (V3 | null)[] {
  const frames = framesOf(exercise);
  const dur = MOTION[exercise].durationMs;
  const u = ((((tMs % dur) + dur) % dur) / dur) * frames.length;
  const i = Math.floor(u) % frames.length;
  const j = (i + 1) % frames.length;
  const k = u - Math.floor(u);
  const A = frames[i]!;
  const B = frames[j]!;
  return A.map((p, n) => {
    const q = B[n];
    return p && q ? { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k } : null;
  });
}

/**
 * Габариты (метры) по всем кадрам всех упражнений в проекции на экран при типичных поворотах:
 * атлеты везде одного роста, фигура не «прыгает» и не обрезается.
 */
let bounds: { w: number; h: number } | null = null;
function boundsOf(): { w: number; h: number } {
  if (bounds) return bounds;
  let w = 0;
  let h = 0;
  for (const exercise of Object.keys(MOTION) as ExerciseId[]) {
    for (const f of framesOf(exercise)) {
      for (const p of f) {
        if (!p) continue;
        for (const yaw of [0, 0.35, 0.7])
          w = Math.max(w, Math.abs(p.x * Math.cos(yaw) - p.z * Math.sin(yaw)) * 2);
        h = Math.max(h, -p.y);
      }
    }
  }
  bounds = { w: Math.max(w, 0.9), h: h + 0.14 };
  return bounds;
}

export interface AthleteStyle {
  /** Поворот вокруг вертикали, рад: 0 — анфас, ~0.5 — три четверти. */
  yaw?: number;
  near?: string;
  far?: string;
  rim?: string;
  glow?: string | null;
  /** Суставы, которые подсветить (демо ошибки). */
  highlight?: ReadonlySet<number>;
  highlightColor?: string;
  shadow?: boolean;
}

/** Радиусы частей тела в метрах: [сустав A, сустав B, r у A, r у B]. */
const PARTS: [number, number, number, number][] = [
  [11, 13, 0.05, 0.04],
  [13, 15, 0.04, 0.03],
  [15, 19, 0.03, 0.024],
  [12, 14, 0.05, 0.04],
  [14, 16, 0.04, 0.03],
  [16, 20, 0.03, 0.024],
  [23, 25, 0.085, 0.058],
  [25, 27, 0.058, 0.04],
  [27, 29, 0.04, 0.034],
  [29, 31, 0.034, 0.028],
  [24, 26, 0.085, 0.058],
  [26, 28, 0.058, 0.04],
  [28, 30, 0.04, 0.034],
  [30, 32, 0.034, 0.028],
];

export function drawAthlete(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  _exercise: ExerciseId,
  pose: (V3 | null)[],
  s: AthleteStyle = {},
): void {
  const yaw = s.yaw ?? 0.35;
  const near = s.near ?? '#fdba74';
  const far = s.far ?? '#9a3412';
  const rim = s.rim ?? 'rgba(255, 237, 213, 0.9)';
  const b = boundsOf();
  const scale = Math.min((W * 0.86) / b.w, (H * 0.9) / b.h);
  const floorY = H * 0.95;
  const cx = W / 2;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  // Проекция: поворот вокруг вертикали; z после поворота — глубина (больше — дальше от зрителя).
  const P = pose.map((p) =>
    p ? { x: cx + (p.x * cos - p.z * sin) * scale, y: floorY + p.y * scale, z: p.x * sin + p.z * cos } : null,
  );
  const get = (i: number) => P[i] ?? null;

  type Item = { z: number; draw: (color: string) => void; hl: boolean };
  const items: Item[] = [];
  const zs: number[] = [];

  for (const [a, c, r1, r2] of PARTS) {
    const A = get(a);
    const B = get(c);
    if (!A || !B) continue;
    const z = (A.z + B.z) / 2;
    zs.push(z);
    items.push({
      z,
      // Подсвечиваем сегмент, только если отмечены оба его сустава: при «сядь глубже» (таз + колени) — бёдра.
      hl: !!s.highlight && s.highlight.has(a) && s.highlight.has(c),
      draw: (color) => limb(ctx, A, B, r1 * scale, r2 * scale, color, rim),
    });
  }

  // Торс: плечи, талия, таз — одним контуром со скруглением.
  const ls = get(11);
  const rs = get(12);
  const lh = get(23);
  const rh = get(24);
  if (ls && rs && lh && rh) {
    const z = (ls.z + rs.z + lh.z + rh.z) / 4;
    zs.push(z);
    items.push({
      z,
      // Торс — только если ошибка про корпус: отмечены и плечи, и таз.
      hl:
        !!s.highlight &&
        (s.highlight.has(11) || s.highlight.has(12)) &&
        (s.highlight.has(23) || s.highlight.has(24)),
      draw: (color) => torso(ctx, ls, rs, lh, rh, scale, color, rim),
    });
    // Голова и шея.
    const le = get(7);
    const re = get(8);
    const nose = get(0);
    const neck = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
    const head =
      le && re ? { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 - 0.02 * scale, z: (le.z + re.z) / 2 } : nose;
    if (head) {
      // Голова и шея всегда поверх торса (иначе при наклоне торс «съедает» голову).
      items.push({
        z: Math.min(neck.z, z) - 0.01,
        hl: false,
        draw: (color) =>
          limb(ctx, neck, { x: head.x, y: head.y + 0.06 * scale }, 0.05 * scale, 0.045 * scale, color, rim),
      });
      items.push({
        z: Math.min(head.z, z) - 0.02,
        hl: false,
        draw: (color) => {
          ctx.beginPath();
          ctx.ellipse(head.x, head.y, 0.095 * scale, 0.115 * scale, 0, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = rim;
          ctx.lineWidth = Math.max(1, scale * 0.006);
          ctx.stroke();
        },
      });
    }
  }

  // Тень на полу.
  if (s.shadow !== false) {
    const g = ctx.createRadialGradient(cx, floorY, 0, cx, floorY, b.w * scale * 0.55);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, floorY, b.w * scale * 0.55, 0.06 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const zmin = Math.min(...zs);
  const zmax = Math.max(...zs);
  items.sort((p, q) => q.z - p.z); // дальние первыми
  ctx.save();
  if (s.glow) {
    ctx.shadowColor = s.glow;
    ctx.shadowBlur = scale * 0.05;
  }
  for (const it of items) {
    const depth = zmax - zmin > 1e-6 ? (it.z - zmin) / (zmax - zmin) : 0;
    const color = it.hl ? (s.highlightColor ?? '#ef4444') : mixHex(near, far, depth * 0.85);
    it.draw(color);
  }
  ctx.restore();
}

function limb(
  ctx: CanvasRenderingContext2D,
  A: Pt,
  B: Pt,
  r1: number,
  r2: number,
  color: string,
  rim: string,
): void {
  capsulePath(ctx, A, B, r1, r2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = Math.max(1, r1 * 0.12);
  ctx.globalAlpha *= 0.55;
  ctx.stroke();
  ctx.globalAlpha /= 0.55;
  // Блик вдоль конечности — ощущение объёма (свет сверху-слева).
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const side = nx + ny < 0 ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(A.x + nx * r1 * 0.45 * side, A.y + ny * r1 * 0.45 * side);
  ctx.lineTo(B.x + nx * r2 * 0.45 * side, B.y + ny * r2 * 0.45 * side);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = Math.max(1, r2 * 0.35);
  ctx.lineCap = 'round';
  ctx.stroke();
}

function torso(
  ctx: CanvasRenderingContext2D,
  ls: Pt,
  rs: Pt,
  lh: Pt,
  rh: Pt,
  scale: number,
  color: string,
  rim: string,
): void {
  // Талия чуть уже таза и плеч: точка на 60% пути от плеча к бедру, сдвинутая к центру.
  const waist = (s: Pt, h: Pt, c: Pt) => {
    const x = s.x + (h.x - s.x) * 0.6;
    const y = s.y + (h.y - s.y) * 0.6;
    return { x: x + (c.x - x) * 0.12, y };
  };
  const center = { x: (ls.x + rs.x + lh.x + rh.x) / 4, y: (ls.y + rs.y + lh.y + rh.y) / 4 };
  const lw = waist(ls, lh, center);
  const rw = waist(rs, rh, center);
  const r = 0.05 * scale;
  ctx.beginPath();
  ctx.moveTo(ls.x, ls.y);
  ctx.quadraticCurveTo((ls.x + rs.x) / 2, Math.min(ls.y, rs.y) - r * 0.6, rs.x, rs.y);
  ctx.quadraticCurveTo(rw.x, rw.y, rh.x, rh.y);
  ctx.quadraticCurveTo((lh.x + rh.x) / 2, Math.max(lh.y, rh.y) + r * 0.8, lh.x, lh.y);
  ctx.quadraticCurveTo(lw.x, lw.y, ls.x, ls.y);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.globalAlpha *= 0.35;
  ctx.lineWidth = Math.max(1, scale * 0.005);
  ctx.stroke();
  ctx.globalAlpha /= 0.35;
}
