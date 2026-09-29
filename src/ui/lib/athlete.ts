// Атлет-эталон (athleteMotion.json, собран scripts/build-ghost.mjs) в стиле анатомического атласа:
// серое тело с рельефом и красные работающие мышцы, яркость — по нагрузке из самой позы.
// 3D-рендер: поворот вокруг вертикали, части тела по глубине (дальние — первыми и темнее),
// конечности — сужающиеся капсулы, под ногами — тень.

import { GHOST_DURATION_MS, ghostPoseAt } from '../../engine/ghostPoses';
import { EXERCISES, type ExerciseId } from '../../engine/types';

/** Что умеет показывать атлет: упражнения движка + эталоны, для которых распознавание ещё впереди (бёрпи). */
export type GhostId = ExerciseId | 'burpee';
import motionData from './athleteMotion.json';
import { capsulePath, mixHex, type Pt } from './shapes';

type V3 = { x: number; y: number; z: number };

interface Motion {
  durationMs: number;
  keep: number[];
  frames: number[][];
}

const RECORDED = motionData as unknown as Partial<Record<GhostId, Motion>>;

/**
 * Упражнения без эталона в athleteMotion.json (новые из E-22) — движение кинематического призрака движка:
 * координаты кадра → метры (рост как у записанного приседа), стопы на полу (y = 0), центр кадра — x = 0.
 */
function ghostMotion(exercise: ExerciseId): Motion {
  const squat = RECORDED.squat!;
  const keep = squat.keep;
  const FRAMES = 60;
  const cycle = (ex: ExerciseId) =>
    Array.from({ length: FRAMES }, (_, i) => ghostPoseAt(ex, (i / FRAMES) * GHOST_DURATION_MS[ex]));
  const noseM = -squat.frames[0]![keep.indexOf(0) * 3 + 1]!;
  const noseToFeet = Math.max(...cycle('squat').map((p) => Math.max(p[31]!.y, p[32]!.y) - p[0]!.y));
  const scale = noseM / noseToFeet;
  const poses = cycle(exercise);
  const floor = Math.max(...poses.flatMap((p) => keep.map((j) => p[j]!.y)));
  return {
    durationMs: GHOST_DURATION_MS[exercise],
    keep,
    frames: poses.map((p) =>
      keep.flatMap((j) => [(p[j]!.x - 0.5) * scale, (p[j]!.y - floor) * scale, p[j]!.z * scale]),
    ),
  };
}

const MOTION = Object.fromEntries(EXERCISES.map((ex) => [ex, RECORDED[ex] ?? ghostMotion(ex)])) as Record<
  GhostId,
  Motion
>;

/** Кадры упражнения как массивы 33 точек (незаписанные — null). */
const cache = new Map<GhostId, (V3 | null)[][]>();
function framesOf(exercise: GhostId): (V3 | null)[][] {
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

/** Ракурс по умолчанию: присед и выпад читаются на три четверти (таз назад, шаг, колено у пола), остальное — анфас. */
export const PREFERRED_YAW: Record<GhostId, number> = {
  squat: 0.35,
  jumping_jack: 0.18,
  lunge: 0.75,
  arm_raise: 0.15,
  // Бёрпи — сбоку: иначе планку и прыжок назад не видно.
  burpee: 1.15,
  high_knees: 0.35,
  knee_to_elbow: 0.18,
  squat_press: 0.35,
  side_bend: 0.15,
  side_leg_raise: 0.15,
  side_lunge: 0.15,
  jump_squat: 0.35,
  calf_raise: 0.9,
  cross_jack: 0.18,
  arm_circles: 0.15,
  boxing: 0.5,
  // Упор лёжа — сбоку, как бёрпи: иначе линию тела не видно.
  push_up: 1.15,
  plank: 1.15,
};

/** Есть ли у упражнения настоящий эталон (запись или кинематика в athleteMotion.json). Нет — рисуем стикмен призрака движка. */
export function hasRecordedMotion(exercise: GhostId): boolean {
  return !!RECORDED[exercise];
}

export function durationOf(exercise: GhostId): number {
  return MOTION[exercise].durationMs;
}

/** Поза в момент tMs (петля), линейная интерполяция между кадрами. */
export function athletePose(exercise: GhostId, tMs: number): (V3 | null)[] {
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
const boundsCache = new Map<string, { w: number; h: number }>();
/** Эталоны со своим масштабом: бёрпи с планкой в полтора метра уменьшил бы всех остальных атлетов. */
const OWN_BOUNDS = new Set<GhostId>(['burpee', 'push_up', 'plank']);

export function athleteBounds(exercise?: GhostId): { w: number; h: number } {
  const own = exercise && OWN_BOUNDS.has(exercise);
  const key = own ? exercise : '*';
  const hit = boundsCache.get(key);
  if (hit) return hit;
  const list = own ? [exercise] : (Object.keys(MOTION) as GhostId[]).filter((ex) => !OWN_BOUNDS.has(ex));
  const yaws = own
    ? [PREFERRED_YAW[exercise] - 0.3, PREFERRED_YAW[exercise], PREFERRED_YAW[exercise] + 0.3]
    : [0, 0.35, 0.7];
  let w = 0;
  let h = 0;
  for (const ex of list) {
    for (const f of framesOf(ex)) {
      for (const p of f) {
        if (!p) continue;
        for (const yaw of yaws) w = Math.max(w, Math.abs(p.x * Math.cos(yaw) - p.z * Math.sin(yaw)) * 2);
        h = Math.max(h, -p.y);
      }
    }
  }
  const b = { w: Math.max(w, 0.9), h: h + 0.14 };
  boundsCache.set(key, b);
  return b;
}

export interface AthleteStyle {
  /** Поворот вокруг вертикали, рад: 0 — анфас, ~0.5 — три четверти. */
  yaw?: number;
  /** Суставы, которые подсветить как ошибку (демо режима «ошибка»). */
  highlight?: ReadonlySet<number>;
  /** Свечение мышц и контура: красиво, но дорого — на телефоне выключаем. */
  glow?: boolean;
  /** Рисовать работающие мышцы (по умолчанию да). */
  muscles?: boolean;
  shadow?: boolean;
}

/**
 * Какие мышцы работают (ЭМГ-исследования и разборы техники):
 * присед — квадрицепсы и ягодичные (+ приводящие); выпад — квадрицепсы и ягодичные передней ноги (+ икры);
 * «звёздочка» — дельты, отводящие мышцы бедра, икры; подъём рук — средние и передние дельты, трапеции.
 */
export type Muscle =
  'quads' | 'hamstrings' | 'adductors' | 'glutes' | 'calves' | 'delts' | 'traps' | 'abductors' | 'pecs';
export const MUSCLES: Record<GhostId, Muscle[]> = {
  squat: ['quads', 'glutes', 'adductors'],
  lunge: ['quads', 'glutes', 'hamstrings', 'calves'],
  jumping_jack: ['delts', 'abductors', 'calves'],
  arm_raise: ['delts', 'traps'],
  burpee: ['quads', 'glutes', 'pecs', 'delts'],
  high_knees: ['quads', 'glutes', 'calves'],
  knee_to_elbow: ['quads', 'glutes'],
  squat_press: ['quads', 'glutes', 'delts', 'traps'],
  side_bend: ['traps'],
  side_leg_raise: ['abductors', 'glutes'],
  side_lunge: ['adductors', 'quads', 'glutes'],
  jump_squat: ['quads', 'glutes', 'calves'],
  calf_raise: ['calves'],
  cross_jack: ['delts', 'abductors', 'adductors', 'calves'],
  arm_circles: ['delts', 'traps'],
  boxing: ['delts', 'traps'],
  push_up: ['pecs', 'delts'],
  plank: ['pecs', 'delts', 'glutes'],
};

/** Названия для подписей в интерфейсе. */
export const MUSCLE_NAMES: Record<GhostId, string[]> = {
  squat: ['квадрицепсы', 'ягодичные', 'приводящие'],
  lunge: ['квадрицепсы', 'ягодичные', 'бицепс бедра', 'икры'],
  jumping_jack: ['дельты', 'отводящие бедра', 'икры'],
  arm_raise: ['дельты', 'трапеции'],
  burpee: ['квадрицепсы', 'ягодичные', 'грудные', 'дельты'],
  high_knees: ['квадрицепсы', 'сгибатели бедра', 'икры'],
  knee_to_elbow: ['косые мышцы живота', 'пресс'],
  squat_press: ['квадрицепсы', 'ягодичные', 'дельты'],
  side_bend: ['косые мышцы живота'],
  side_leg_raise: ['отводящие бедра', 'ягодичные'],
  side_lunge: ['приводящие', 'квадрицепсы', 'ягодичные'],
  jump_squat: ['квадрицепсы', 'ягодичные', 'икры'],
  calf_raise: ['икры'],
  cross_jack: ['дельты', 'отводящие и приводящие бедра', 'икры'],
  arm_circles: ['дельты', 'трапеции'],
  boxing: ['дельты', 'трицепсы', 'косые мышцы живота'],
  push_up: ['грудные', 'трицепсы', 'дельты'],
  plank: ['пресс', 'дельты', 'ягодичные'],
};

/** Радиусы частей тела в метрах: [сустав A, сустав B, r у A, r у B]. */
const PARTS: [number, number, number, number][] = [
  [11, 13, 0.052, 0.04],
  [13, 15, 0.04, 0.03],
  [15, 19, 0.03, 0.024],
  [12, 14, 0.052, 0.04],
  [14, 16, 0.04, 0.03],
  [16, 20, 0.03, 0.024],
  [23, 25, 0.088, 0.058],
  [25, 27, 0.06, 0.04],
  [27, 29, 0.04, 0.034],
  [29, 31, 0.034, 0.028],
  [24, 26, 0.088, 0.058],
  [26, 28, 0.06, 0.04],
  [28, 30, 0.04, 0.034],
  [30, 32, 0.034, 0.028],
];

// Палитра «анатомического атласа»: серое тело, красные работающие мышцы.
const SKIN_NEAR = '#cfd5dd';
const SKIN_FAR = '#4b5563';
const RIM = 'rgba(255, 255, 255, 0.55)';
const LINE = 'rgba(15, 23, 42, 0.32)';
const MUSCLE_DARK = '#be123c';
const MUSCLE_LIGHT = '#fb7185';
const ERROR = '#ef4444';

type SPt = Pt & { z: number };

export function drawAthlete(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  exercise: GhostId,
  pose: (V3 | null)[],
  s: AthleteStyle = {},
): void {
  const yaw = s.yaw ?? 0.35;
  const glow = s.glow !== false;
  const muscles = s.muscles !== false ? new Set(MUSCLES[exercise]) : new Set<Muscle>();
  const b = athleteBounds(exercise);
  const scale = Math.min((W * 0.86) / b.w, (H * 0.9) / b.h);
  const floorY = H * 0.95;
  const cx = W / 2;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  // Проекция: поворот вокруг вертикали; z после поворота — глубина (больше — дальше от зрителя).
  const P: (SPt | null)[] = pose.map((p) =>
    p ? { x: cx + (p.x * cos - p.z * sin) * scale, y: floorY + p.y * scale, z: p.x * sin + p.z * cos } : null,
  );
  const get = (i: number) => P[i] ?? null;
  const act = activation(exercise, pose);

  type Item = { z: number; draw: (skin: string) => void };
  const items: Item[] = [];
  const zs: number[] = [];

  for (const [a, c, r1, r2] of PARTS) {
    const A = get(a);
    const B = get(c);
    if (!A || !B) continue;
    const z = (A.z + B.z) / 2;
    zs.push(z);
    const hl = !!s.highlight && s.highlight.has(a) && s.highlight.has(c);
    const R1 = r1 * scale;
    const R2 = r2 * scale;
    items.push({
      z,
      draw: (skin) => {
        limb(ctx, A, B, R1, R2, hl ? ERROR : skin, glow && hl);
        if (hl) return;
        // Работающая мышца поверх сегмента — или тонкий рельеф, если она сейчас не при чём.
        const m = muscleOn(a, c, muscles);
        if (m) belly(ctx, A, B, R1, R2, m.from, m.to, m.width, act[m.key], glow);
        else relief(ctx, A, B, R1, R2, a);
      },
    });
  }

  // Торс, шея, голова.
  const ls = get(11);
  const rs = get(12);
  const lh = get(23);
  const rh = get(24);
  if (ls && rs && lh && rh) {
    const z = (ls.z + rs.z + lh.z + rh.z) / 4;
    zs.push(z);
    const hl =
      !!s.highlight &&
      (s.highlight.has(11) || s.highlight.has(12)) &&
      (s.highlight.has(23) || s.highlight.has(24));
    items.push({
      z,
      draw: (skin) => {
        torso(ctx, ls, rs, lh, rh, scale, hl ? ERROR : skin);
        if (hl) return;
        torsoRelief(ctx, ls, rs, lh, rh, scale);
        if (muscles.has('glutes') || muscles.has('abductors')) {
          const k = muscles.has('glutes') ? act.glutes : act.abductors;
          for (const [h, sh] of [
            [lh, ls],
            [rh, rs],
          ] as const) {
            hipCap(ctx, h, sh, lh, rh, scale, k, glow);
          }
        }
        if (muscles.has('traps')) traps(ctx, ls, rs, scale, act.traps, glow);
        if (muscles.has('delts')) {
          const L = get(13);
          const R = get(14);
          if (L) deltCap(ctx, ls, L, scale, act.deltsL, glow);
          if (R) deltCap(ctx, rs, R, scale, act.deltsR, glow);
        }
      },
    });
    const le = get(7);
    const re = get(8);
    const nose = get(0);
    const neck = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const head = le && re ? { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 - 0.02 * scale } : nose;
    if (head) {
      items.push({
        z: z - 0.01,
        draw: (skin) =>
          limb(ctx, neck, { x: head.x, y: head.y + 0.06 * scale }, 0.05 * scale, 0.045 * scale, skin, false),
      });
      items.push({
        z: z - 0.02,
        draw: (skin) => {
          ctx.beginPath();
          ctx.ellipse(head.x, head.y, 0.092 * scale, 0.112 * scale, 0, 0, Math.PI * 2);
          ctx.fillStyle = skin;
          ctx.fill();
          ctx.strokeStyle = RIM;
          ctx.lineWidth = Math.max(1, scale * 0.005);
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
  for (const it of items) {
    const depth = zmax - zmin > 1e-6 ? (it.z - zmin) / (zmax - zmin) : 0;
    it.draw(mixHex(SKIN_NEAR, SKIN_FAR, depth * 0.8));
  }
}

/** Нагрузка мышц 0..1 из самой позы: сгиб колена, подъём рук, ширина стойки. */
export function activation(exercise: GhostId, pose: (V3 | null)[]) {
  const bend = (h: number, k: number, a: number) => {
    const H = pose[h];
    const K = pose[k];
    const A = pose[a];
    if (!H || !K || !A) return 0;
    const u = { x: H.x - K.x, y: H.y - K.y, z: H.z - K.z };
    const v = { x: A.x - K.x, y: A.y - K.y, z: A.z - K.z };
    const cosA =
      (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) || 1);
    const deg = (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI;
    return Math.max(0, Math.min(1, (175 - deg) / 85));
  };
  const lift = (sh: number, el: number) => {
    const S = pose[sh];
    const E = pose[el];
    if (!S || !E) return 0;
    const d = { x: E.x - S.x, y: E.y - S.y, z: E.z - S.z };
    const deg =
      (Math.acos(Math.max(-1, Math.min(1, d.y / (Math.hypot(d.x, d.y, d.z) || 1)))) * 180) / Math.PI;
    return Math.max(0, Math.min(1, deg / 165));
  };
  const kneeL = bend(23, 25, 27);
  const kneeR = bend(24, 26, 28);
  const la = pose[27];
  const ra = pose[28];
  const spread = la && ra ? Math.max(0, Math.min(1, (Math.abs(la.x - ra.x) - 0.25) / 0.55)) : 0;
  const deltsL = lift(11, 13);
  const deltsR = lift(12, 14);
  const knees = Math.max(kneeL, kneeR);
  // Упор на руки (планка, упор присев): корпус к горизонтали и кисти ниже плеч — работают грудь и плечи.
  const sh = pose[11];
  const hp = pose[23];
  const wr = pose[15];
  const flat =
    sh && hp
      ? Math.max(
          0,
          Math.min(1, 1.6 * (1 - Math.abs(sh.y - hp.y) / (Math.hypot(sh.y - hp.y, sh.z - hp.z) || 1))),
        )
      : 0;
  const support = wr && sh && wr.y > sh.y + 0.3 ? flat : 0;
  return {
    quadsL: kneeL,
    quadsR: kneeR,
    adductors: knees,
    glutes: knees,
    calves: exercise === 'jumping_jack' ? 0.5 + 0.5 * spread : knees,
    deltsL,
    deltsR,
    traps: Math.max(deltsL, deltsR),
    abductors: spread,
    pecs: support,
    ...(exercise === 'burpee'
      ? { deltsL: Math.max(deltsL, support), deltsR: Math.max(deltsR, support) }
      : {}),
  };
}

type ActKey = keyof ReturnType<typeof activation>;

/** Какая мышца лежит на сегменте [a, c] и какую часть его занимает. */
function muscleOn(a: number, _c: number, on: Set<Muscle>) {
  const side = a % 2 === 1 ? 'L' : 'R';
  if ((a === 23 || a === 24) && on.has('quads'))
    return { key: `quads${side}` as ActKey, from: 0.14, to: 0.9, width: 0.86 };
  if ((a === 23 || a === 24) && on.has('adductors'))
    return { key: 'adductors' as ActKey, from: 0.08, to: 0.6, width: 0.5 };
  if ((a === 25 || a === 26) && on.has('calves'))
    return { key: 'calves' as ActKey, from: 0.08, to: 0.62, width: 0.8 };
  if ((a === 11 || a === 12) && on.has('delts'))
    return { key: `delts${side}` as ActKey, from: 0, to: 0.46, width: 1 };
  return null;
}

function limb(
  ctx: CanvasRenderingContext2D,
  A: Pt,
  B: Pt,
  r1: number,
  r2: number,
  color: string,
  glow: boolean,
): void {
  capsulePath(ctx, A, B, r1, r2);
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = r1 * 1.2;
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = RIM;
  ctx.lineWidth = Math.max(1, r1 * 0.09);
  ctx.globalAlpha *= 0.5;
  ctx.stroke();
  ctx.globalAlpha /= 0.5;
  // Блик вдоль конечности — объём (свет сверху-слева).
  const n = normal(A, B);
  const side = n.x + n.y < 0 ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(A.x + n.x * r1 * 0.45 * side, A.y + n.y * r1 * 0.45 * side);
  ctx.lineTo(B.x + n.x * r2 * 0.45 * side, B.y + n.y * r2 * 0.45 * side);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = Math.max(1, r2 * 0.3);
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** Брюшко работающей мышцы: сужающаяся капсула внутри сегмента, красный градиент и волокна. */
function belly(
  ctx: CanvasRenderingContext2D,
  A: Pt,
  B: Pt,
  r1: number,
  r2: number,
  from: number,
  to: number,
  width: number,
  load: number,
  glow: boolean,
): void {
  const at = (t: number) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
  const rAt = (t: number) => r1 + (r2 - r1) * t;
  const M1 = at(from);
  const M2 = at(to);
  const mid = (from + to) / 2;
  const R1 = rAt(from) * width * 0.9;
  const R2 = rAt(to) * width * 0.55;
  const k = 0.45 + 0.55 * load; // мышца видна всегда, ярче — под нагрузкой
  const g = ctx.createLinearGradient(M1.x, M1.y, M2.x, M2.y);
  g.addColorStop(0, MUSCLE_DARK);
  g.addColorStop(0.45, MUSCLE_LIGHT);
  g.addColorStop(1, MUSCLE_DARK);
  ctx.save();
  ctx.globalAlpha *= k;
  if (glow) {
    ctx.shadowColor = 'rgba(244, 63, 94, 0.9)';
    ctx.shadowBlur = rAt(mid) * (0.6 + 1.4 * load);
  }
  capsulePath(ctx, M1, M2, R1, R2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  // Волокна вдоль мышцы.
  const n = normal(A, B);
  ctx.strokeStyle = 'rgba(255, 228, 230, 0.45)';
  ctx.lineWidth = Math.max(0.8, rAt(mid) * 0.06);
  for (const o of [-0.5, -0.15, 0.2, 0.52]) {
    ctx.beginPath();
    ctx.moveTo(M1.x + n.x * R1 * o, M1.y + n.y * R1 * o);
    const c = at(mid);
    ctx.quadraticCurveTo(
      c.x + n.x * rAt(mid) * width * o * 1.05,
      c.y + n.y * rAt(mid) * width * o * 1.05,
      M2.x + n.x * R2 * o * 0.6,
      M2.y + n.y * R2 * o * 0.6,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** Тонкий рельеф неработающего сегмента: разделение мышц бедра, коленная чашечка. */
function relief(ctx: CanvasRenderingContext2D, A: Pt, B: Pt, r1: number, r2: number, a: number): void {
  const n = normal(A, B);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(0.8, r1 * 0.06);
  if (a === 23 || a === 24) {
    const at = (t: number) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
    const p1 = at(0.2);
    const p2 = at(0.85);
    const c = at(0.55);
    ctx.beginPath();
    ctx.moveTo(p1.x + n.x * r1 * 0.3, p1.y + n.y * r1 * 0.3);
    ctx.quadraticCurveTo(c.x - n.x * r1 * 0.25, c.y - n.y * r1 * 0.25, p2.x, p2.y);
    ctx.stroke();
  }
  if (a === 25 || a === 26) {
    ctx.beginPath();
    ctx.arc(A.x, A.y, r1 * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }
  void r2;
}

function torso(
  ctx: CanvasRenderingContext2D,
  ls: Pt,
  rs: Pt,
  lh: Pt,
  rh: Pt,
  scale: number,
  color: string,
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
  ctx.strokeStyle = RIM;
  ctx.globalAlpha *= 0.35;
  ctx.lineWidth = Math.max(1, scale * 0.005);
  ctx.stroke();
  ctx.globalAlpha /= 0.35;
}

/** Рельеф торса: грудные, белая линия и кубики пресса — «анатомический атлас». */
function torsoRelief(ctx: CanvasRenderingContext2D, ls: Pt, rs: Pt, lh: Pt, rh: Pt, scale: number): void {
  const L = (a: Pt, b: Pt, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const top = L(ls, rs, 0.5);
  const bottom = L(lh, rh, 0.5);
  ctx.save();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(0.8, scale * 0.005);
  ctx.lineCap = 'round';
  // Грудные: две дуги от плеч к середине.
  for (const [sh, sign] of [
    [ls, 1],
    [rs, -1],
  ] as const) {
    const start = L(sh, top, 0.15);
    const lower = L(L(sh, top, 0.55), L(ls === sh ? lh : rh, bottom, 0.5), 0.3);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y + 0.02 * scale);
    ctx.quadraticCurveTo(
      lower.x - sign * 0.01 * scale,
      lower.y + 0.05 * scale,
      L(top, bottom, 0.3).x,
      L(top, bottom, 0.3).y,
    );
    ctx.stroke();
  }
  // Белая линия и пресс.
  const a = L(top, bottom, 0.34);
  const z = L(top, bottom, 0.9);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(z.x, z.y);
  ctx.stroke();
  const half = Math.hypot(ls.x - rs.x, ls.y - rs.y) * 0.16;
  for (const t of [0.46, 0.6, 0.74]) {
    const p = L(top, bottom, t);
    ctx.beginPath();
    ctx.moveTo(p.x - half, p.y);
    ctx.lineTo(p.x + half, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Ягодичные / отводящие бедра: красная «шапка» над тазобедренным суставом снаружи. */
function hipCap(
  ctx: CanvasRenderingContext2D,
  hip: Pt,
  sh: Pt,
  lh: Pt,
  rh: Pt,
  scale: number,
  load: number,
  glow: boolean,
): void {
  const cx = (lh.x + rh.x) / 2;
  const out = Math.sign(hip.x - cx) || 1;
  const x = hip.x + out * 0.035 * scale;
  const y = hip.y - 0.035 * scale + (sh.y - hip.y) * 0.02;
  muscleBlob(ctx, x, y, 0.06 * scale, 0.085 * scale, out * 0.3, load, glow);
}

/** Дельта: шапка плеча и начало плеча, повёрнутая вдоль руки. */
function deltCap(
  ctx: CanvasRenderingContext2D,
  sh: Pt,
  el: Pt,
  scale: number,
  load: number,
  glow: boolean,
): void {
  const ang = Math.atan2(el.y - sh.y, el.x - sh.x);
  const x = sh.x + (el.x - sh.x) * 0.18;
  const y = sh.y + (el.y - sh.y) * 0.18;
  muscleBlob(ctx, x, y, 0.1 * scale, 0.06 * scale, ang, load, glow);
}

/** Трапеции: от шеи к плечам. */
function traps(
  ctx: CanvasRenderingContext2D,
  ls: Pt,
  rs: Pt,
  scale: number,
  load: number,
  glow: boolean,
): void {
  for (const sh of [ls, rs]) {
    const nx = (ls.x + rs.x) / 2;
    const ny = (ls.y + rs.y) / 2 - 0.05 * scale;
    const x = (nx + sh.x) / 2;
    const y = (ny + sh.y) / 2 - 0.01 * scale;
    muscleBlob(
      ctx,
      x,
      y,
      Math.hypot(sh.x - nx, sh.y - ny) * 0.55,
      0.03 * scale,
      Math.atan2(sh.y - ny, sh.x - nx),
      load,
      glow,
    );
  }
}

function muscleBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot: number,
  load: number,
  glow: boolean,
): void {
  ctx.save();
  ctx.globalAlpha *= 0.45 + 0.55 * load;
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
  g.addColorStop(0, MUSCLE_LIGHT);
  g.addColorStop(1, MUSCLE_DARK);
  if (glow) {
    ctx.shadowColor = 'rgba(244, 63, 94, 0.9)';
    ctx.shadowBlur = Math.max(rx, ry) * (0.5 + load);
  }
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function normal(A: Pt, B: Pt): Pt {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}
