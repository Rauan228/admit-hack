#!/usr/bin/env node
// «Призрак» из настоящего движения: берём записанные позы реальных людей (tests/fixtures, MediaPipe world
// landmarks — 3D в метрах), находим в каждой записи самый чистый и глубокий повтор, сглаживаем,
// убираем «зависания» внизу, зацикливаем и сохраняем компактно в src/ui/lib/athleteMotion.json.
//
//   node scripts/build-ghost.mjs
//
// Корпус разворачиваем лицом к зрителю (по линии таза).
// Выпад и подъём рук строим на настоящем теле из записи приседа (его пропорции и осанка): в записях выпадов у
// авторов гиря над головой и разворот корпуса, эталон из них не получается. Ноги выпада — двухзвенная
// обратная кинематика (переднее колено 90°, заднее у пола), руки подъёма — прямые, через стороны.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES = 60; // кадров на цикл
/** Точки, которые рисует фигура (остальные не храним). */
const KEEP = [0, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

const SOURCES = {
  // В записи присед с гирей у груди; руки делаем как в приседе без веса — вперёд для баланса.
  squat: { file: 'squat-front-goblet.json', signal: 'hipDrop', durationMs: 2600, armsForward: true },
  jumping_jack: { file: 'jumping-jack-front.json', signal: 'armsUp', durationMs: 1100 },
};

const avg = (...v) => v.reduce((a, b) => a + b, 0) / v.length;

function load(file) {
  const data = JSON.parse(readFileSync(resolve(root, 'tests/fixtures', file), 'utf8'));
  const frames = data.frames
    .filter((f) => f.w && f.w.length === 99 && f.p.length === 132)
    .map((f) => {
      const pts = [];
      for (let i = 0; i < 33; i += 1) pts.push({ x: f.w[i * 3], y: f.w[i * 3 + 1], z: f.w[i * 3 + 2], v: f.p[i * 4 + 3] });
      return { t: f.t, pts };
    });
  return frames;
}

/** Сигнал повтора: больше = «нижняя точка» / «пик» движения. */
function signal(kind, pts) {
  const ankleY = avg(pts[27].y, pts[28].y);
  const hipY = avg(pts[23].y, pts[24].y);
  if (kind === 'hipDrop') return hipY - ankleY + 1; // y вниз: таз ближе к стопам — глубже
  // armsUp: запястья выше плеч
  return avg(pts[11].y, pts[12].y) - avg(pts[15].y, pts[16].y);
}

/** Скользящее среднее ±k кадров по каждой координате. */
function smooth(frames, k = 3) {
  return frames.map((f, i) => {
    const win = frames.slice(Math.max(0, i - k), i + k + 1);
    return {
      t: f.t,
      pts: f.pts.map((_, j) => ({
        x: avg(...win.map((w) => w.pts[j].x)),
        y: avg(...win.map((w) => w.pts[j].y)),
        z: avg(...win.map((w) => w.pts[j].z)),
        v: Math.min(...win.map((w) => w.pts[j].v)),
      })),
    };
  });
}

/** Самый глубокий повтор: минимум сигнала → максимум → минимум, с полной амплитудой. */
function bestRep(frames, kind) {
  const s = frames.map((f) => signal(kind, f.pts));
  const lo = Math.min(...s);
  const hi = Math.max(...s);
  const mid = lo + (hi - lo) * 0.5;
  // Разбиваем на эпизоды «выше середины» — это пики движения.
  const peaks = [];
  let start = -1;
  s.forEach((v, i) => {
    if (v > mid && start < 0) start = i;
    if ((v <= mid || i === s.length - 1) && start >= 0) {
      peaks.push([start, i]);
      start = -1;
    }
  });
  let best = null;
  for (const [a, b] of peaks) {
    // Расширяем эпизод до ближайших «исходных положений» слева и справа.
    let l = a;
    while (l > 0 && s[l - 1] <= s[l]) l -= 1;
    let r = b;
    while (r < s.length - 1 && s[r + 1] <= s[r]) r += 1;
    const peak = Math.max(...s.slice(a, b + 1));
    const base = Math.max(s[l], s[r]);
    const amp = peak - base;
    const vis = avg(...frames.slice(l, r + 1).flatMap((f) => KEEP.map((j) => f.pts[j].v)));
    const score = amp * vis * vis;
    if (r - l > 8 && (!best || score > best.score)) best = { l, r, amp, vis, score, peak, base };
  }
  return best;
}

/** Параметр вдоль движения: длина пути сигнала + немного времени — «зависание» внизу сжимается. */
function resample(frames, kind, n) {
  const s = frames.map((f) => signal(kind, f.pts));
  const u = [0];
  for (let i = 1; i < s.length; i += 1) u.push(u[i - 1] + Math.abs(s[i] - s[i - 1]) * 0.8 + 0.2 / s.length);
  const total = u[u.length - 1];
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const target = (k / n) * total;
    let i = 0;
    while (i < u.length - 2 && u[i + 1] < target) i += 1;
    const w = (target - u[i]) / Math.max(1e-9, u[i + 1] - u[i]);
    const A = frames[i].pts;
    const B = frames[i + 1].pts;
    out.push(A.map((p, j) => ({ x: p.x + (B[j].x - p.x) * w, y: p.y + (B[j].y - p.y) * w, z: p.z + (B[j].z - p.z) * w })));
  }
  return out;
}

/** Бесшовная петля: последние кадры плавно переходят в первый. */
function loop(frames, blend = 8) {
  const n = frames.length;
  return frames.map((pts, k) => {
    const w = k >= n - blend ? (k - (n - blend) + 1) / (blend + 1) : 0;
    if (!w) return pts;
    const first = frames[0];
    return pts.map((p, j) => ({
      x: p.x + (first[j].x - p.x) * w,
      y: p.y + (first[j].y - p.y) * w,
      z: p.z + (first[j].z - p.z) * w,
    }));
  });
}

/** Стопы на полу: сдвигаем кадр так, чтобы нижняя точка стоп была на y = 0 (y вниз → пол = максимум y). */
function ground(frames) {
  return frames.map((pts) => {
    const floor = Math.max(pts[29].y, pts[30].y, pts[31].y, pts[32].y);
    return pts.map((p) => ({ ...p, y: p.y - floor }));
  });
}

/** Поворот вокруг вертикали так, чтобы таз в среднем по повтору смотрел на зрителя. */
function faceViewer(frames) {
  const a = avg(...frames.map((pts) => Math.atan2(pts[24].z - pts[23].z, pts[24].x - pts[23].x)));
  const target = Math.atan2(0, frames[0][24].x - frames[0][23].x >= 0 ? 1 : -1);
  const d = target - a;
  const c = Math.cos(d);
  const s = Math.sin(d);
  return frames.map((pts) => pts.map((p) => ({ ...p, x: p.x * c - p.z * s, z: p.x * s + p.z * c })));
}

/** Руки вдоль тела: локоть и кисть висят от плеча, следуя за корпусом. */
function hangArms(frames) {
  return frames.map((pts) => {
    const out = pts.map((p) => ({ ...p }));
    for (const [sh, el, wr, idx, pinky, thumb, side] of [
      [11, 13, 15, 19, 17, 21, -1],
      [12, 14, 16, 20, 18, 22, 1],
    ]) {
      const s = pts[sh];
      const sideSign = Math.sign(pts[sh].x - avg(pts[11].x, pts[12].x)) || side;
      out[el] = { x: s.x + sideSign * 0.05, y: s.y + 0.27, z: s.z + 0.01 };
      out[wr] = { x: s.x + sideSign * 0.07, y: s.y + 0.52, z: s.z - 0.02 };
      for (const j of [idx, pinky, thumb]) out[j] = { x: out[wr].x, y: out[wr].y + 0.07, z: out[wr].z - 0.01 };
    }
    return out;
  });
}

/** Руки вперёд для баланса: чем глубже присед, тем выше (от 15° до 85° от вертикали). */
function armsForward(frames) {
  const depth = frames.map((pts) => avg(pts[23].y, pts[24].y) - avg(pts[27].y, pts[28].y));
  const lo = Math.min(...depth);
  const hi = Math.max(...depth);
  return frames.map((pts, k) => {
    const w = hi - lo > 1e-6 ? (depth[k] - lo) / (hi - lo) : 0;
    const a = ((15 + 70 * w) * Math.PI) / 180;
    const out = pts.map((p) => ({ ...p }));
    for (const [sh, el, wr, idx] of [
      [11, 13, 15, 19],
      [12, 14, 16, 20],
    ]) {
      const s = pts[sh];
      const dir = { y: Math.cos(a), z: -Math.sin(a) };
      out[el] = { x: s.x, y: s.y + dir.y * 0.3, z: s.z + dir.z * 0.3 };
      out[wr] = { x: s.x, y: s.y + dir.y * 0.57, z: s.z + dir.z * 0.57 };
      out[idx] = { x: s.x, y: s.y + dir.y * 0.65, z: s.z + dir.z * 0.65 };
      out[idx - 2] = out[idx];
    }
    return out;
  });
}

/** Колено двухзвенной ноги: бедро L1, голень L2, от таза H к щиколотке A; колено выводим вперёд (−z). */
function knee(H, A, L1, L2) {
  const dy = A.y - H.y;
  const dz = A.z - H.z;
  const D = Math.min(Math.hypot(dy, dz), L1 + L2 - 1e-4);
  const a = Math.acos((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D));
  const base = Math.atan2(dz, dy); // угол направления на щиколотку в плоскости (y, z)
  const ang = base - a; // поворот к −z: колено вперёд
  return { x: H.x + (A.x - H.x) * (L1 / (L1 + L2)), y: H.y + L1 * Math.cos(ang), z: H.z + L1 * Math.sin(ang) };
}

/** Выпад на месте (разножка): таз опускается, переднее колено до 90°, заднее — почти до пола. */
function lunge(stand, n) {
  const L1 = Math.hypot(stand[25].x - stand[23].x, stand[25].y - stand[23].y, stand[25].z - stand[23].z);
  const L2 = Math.hypot(stand[27].x - stand[25].x, stand[27].y - stand[25].y, stand[27].z - stand[25].z);
  const hip0 = avg(stand[23].y, stand[24].y);
  const FRONT_Z = -0.42;
  const BACK_Z = 0.5;
  // Максимальная глубина: заднее колено в 8 см от пола (пол — y = max по стопам).
  const floor = Math.max(stand[29].y, stand[30].y, stand[31].y, stand[32].y);
  const backAnkle = (H) => ({ x: H.x, y: floor - 0.1, z: BACK_Z });
  let lo = 0;
  let hi = 0.7;
  for (let i = 0; i < 30; i += 1) {
    const m = (lo + hi) / 2;
    const H = { x: stand[24].x, y: hip0 + m, z: 0.05 };
    const K = knee(H, backAnkle(H), L1, L2);
    if (K.y > floor - 0.09) hi = m;
    else lo = m;
  }
  const maxDrop = lo;
  return Array.from({ length: n }, (_, k) => {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / n);
    const drop = maxDrop * w;
    const pts = stand.map((p) => ({ ...p, y: p.y + (p.y < hip0 + 0.02 ? drop : 0) }));
    // Корпус немного вперёд вместе с тазом — центр тяжести над серединой стойки.
    for (const p of pts) if (p.y < hip0 + drop + 0.02) p.z += 0.05 * w;
    // Передняя нога — левая, задняя — правая.
    const lh = { ...pts[23] };
    const rh = { ...pts[24] };
    const la = { x: lh.x, y: floor - 0.07, z: FRONT_Z };
    const ra = backAnkle(rh);
    pts[25] = knee(lh, la, L1, L2);
    pts[27] = la;
    pts[29] = { x: la.x, y: floor, z: FRONT_Z + 0.05 };
    pts[31] = { x: la.x, y: floor, z: FRONT_Z - 0.17 };
    pts[26] = knee(rh, ra, L1, L2);
    pts[28] = ra;
    pts[30] = { x: ra.x, y: floor - 0.08, z: BACK_Z + 0.06 };
    pts[32] = { x: ra.x, y: floor, z: BACK_Z - 0.1 };
    return pts;
  });
}

/** Подъём прямых рук через стороны на неподвижном теле. */
function armRaise(stand, n) {
  const UP = 0.3; // плечо → локоть, м
  const LO = 0.27; // локоть → кисть
  return Array.from({ length: n }, (_, k) => {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / n);
    const ang = ((12 + 160 * w) * Math.PI) / 180;
    const pts = stand.map((p) => ({ ...p }));
    for (const [sh, el, wr, idx] of [
      [11, 13, 15, 19],
      [12, 14, 16, 20],
    ]) {
      const side = Math.sign(stand[sh].x - avg(stand[11].x, stand[12].x)) || 1;
      const dir = { x: side * Math.sin(ang), y: Math.cos(ang) };
      const s = stand[sh];
      pts[el] = { x: s.x + dir.x * UP, y: s.y + dir.y * UP, z: s.z };
      pts[wr] = { x: s.x + dir.x * (UP + LO), y: s.y + dir.y * (UP + LO), z: s.z };
      pts[idx] = { x: s.x + dir.x * (UP + LO + 0.08), y: s.y + dir.y * (UP + LO + 0.08), z: s.z };
      pts[idx - 2] = pts[idx];
    }
    return pts;
  });
}

const r3 = (v) => Math.round(v * 1000) / 1000;
function pack(frames, durationMs, source) {
  return {
    durationMs,
    source,
    keep: KEEP,
    frames: frames.map((pts) => KEEP.flatMap((j) => [r3(pts[j].x), r3(pts[j].y), r3(pts[j].z)])),
  };
}

const out = {};
let stand = null;
for (const [exercise, cfg] of Object.entries(SOURCES)) {
  const raw = load(cfg.file);
  const frames = smooth(raw, 3);
  const rep = bestRep(frames, cfg.signal);
  if (!rep) throw new Error(`no rep in ${cfg.file}`);
  const seg = frames.slice(rep.l, rep.r + 1);
  let motion = faceViewer(loop(resample(seg, cfg.signal, FRAMES)));
  if (cfg.armsForward) motion = armsForward(motion);
  motion = ground(motion);
  out[exercise] = pack(motion, cfg.durationMs, cfg.file);
  console.log(
    `${exercise}: ${cfg.file} кадры ${rep.l}–${rep.r} (${(seg[0].t / 1000).toFixed(1)}–${(seg.at(-1).t / 1000).toFixed(1)} с), ` +
      `амплитуда ${rep.amp.toFixed(3)}, видимость ${rep.vis.toFixed(2)}`,
  );
  if (exercise === 'squat') stand = hangArms([motion[0]])[0];
}

// Выпад и подъём рук — на прямой стойке из записи приседа (в «звёздочке» кадр приземления с наклоном).
out.arm_raise = pack(ground(armRaise(stand, FRAMES)), 2600, `${SOURCES.squat.file} (стойка) + прямые руки`);
out.lunge = pack(ground(hangArms(lunge(stand, FRAMES))), 3000, `${SOURCES.squat.file} (стойка) + кинематика ног`);

const target = resolve(root, 'src/ui/lib/athleteMotion.json');
writeFileSync(target, JSON.stringify(out));
console.log('→', target, `${(JSON.stringify(out).length / 1024).toFixed(1)} KB`);
