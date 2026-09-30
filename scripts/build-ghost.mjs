#!/usr/bin/env node
// «Призрак» из настоящего движения: берём записанные позы реальных людей (tests/fixtures, MediaPipe world
// landmarks — 3D в метрах), находим в каждой записи самый чистый и глубокий повтор, сглаживаем,
// убираем «зависания» внизу, зацикливаем и сохраняем компактно в src/ui/lib/athleteMotion.json.
//
//   node scripts/build-ghost.mjs
//
// Присед — настоящий повтор человека из записи (руки вперёд, как в приседе без веса). «Звёздочка», выпады и
// подъём рук — идеальная техника, построенная кинематикой на ровном симметричном теле с пропорциями того же
// человека (длины рук, ног, корпуса, ширина плеч и таза).
// Корпус записи разворачиваем лицом к зрителю (по линии таза).
// Выпад и подъём рук строим на настоящем теле из записи приседа (его пропорции и осанка): в записях выпадов у
// авторов гиря над головой и разворот корпуса, эталон из них не получается. Ноги выпада — двухзвенная
// обратная кинематика (переднее колено 90°, заднее у пола), руки подъёма — прямые, через стороны.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specMotion } from './ghost-spec.mjs';
import { spec3dMotion } from './ghost-spec3d.mjs';
import { videoMotion } from './ghost-video.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES = 60; // кадров на цикл
/** Точки, которые рисует фигура (остальные не храним). */
const KEEP = [0, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

/** Присед — настоящий повтор человека из записи; из той же записи — пропорции тела для остальных. */
const SOURCES = {
  // В записи присед с гирей у груди; руки делаем как в приседе без веса — вперёд для баланса.
  squat: { file: 'squat-front-goblet.json', signal: 'hipDrop', durationMs: 2600, armsForward: true },
};

const avg = (...v) => v.reduce((a, b) => a + b, 0) / v.length;

function load(file) {
  const data = JSON.parse(readFileSync(resolve(root, 'tests/fixtures', file), 'utf8'));
  const frames = data.frames
    .filter((f) => f.w && f.w.length === 99 && f.p.length === 132)
    .map((f) => {
      const pts = [];
      for (let i = 0; i < 33; i += 1)
        pts.push({ x: f.w[i * 3], y: f.w[i * 3 + 1], z: f.w[i * 3 + 2], v: f.p[i * 4 + 3] });
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
    out.push(
      A.map((p, j) => ({
        x: p.x + (B[j].x - p.x) * w,
        y: p.y + (B[j].y - p.y) * w,
        z: p.z + (B[j].z - p.z) * w,
      })),
    );
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

const smooth01 = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Ровное тело: пропорции реального человека (средние по левой и правой стороне), корпус вертикально,
 * всё симметрично. Ось y вниз, пол — y = 0, лицом к зрителю — −z.
 */
function canonical(real) {
  const P = (i) => real[i];
  const upperArm = avg(dist3(P(11), P(13)), dist3(P(12), P(14)));
  const forearm = avg(dist3(P(13), P(15)), dist3(P(14), P(16)));
  const thigh = avg(dist3(P(23), P(25)), dist3(P(24), P(26)));
  const shin = avg(dist3(P(25), P(27)), dist3(P(26), P(28)));
  const shoulderHalf = Math.abs(P(11).x - P(12).x) / 2;
  const hipHalf = Math.abs(P(23).x - P(24).x) / 2;
  const torso = Math.abs(avg(P(11).y, P(12).y) - avg(P(23).y, P(24).y));
  const side = Math.sign(P(11).x - P(12).x) || 1; // левая сторона человека: знак x
  const ankleH = 0.08;
  const hipY = -(ankleH + shin + thigh) * 0.985; // ноги почти прямые
  const shY = hipY - torso;
  const pts = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (i, x, y, z = 0) => (pts[i] = { x, y, z });
  for (const [s, sh, el, wr, pk, ix, th, hp, kn, an, he, to, ear] of [
    [side, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 7],
    [-side, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 8],
  ]) {
    set(sh, s * shoulderHalf, shY);
    set(el, s * (shoulderHalf + 0.03), shY + upperArm);
    set(wr, s * (shoulderHalf + 0.04), shY + upperArm + forearm, -0.02);
    for (const j of [pk, ix, th]) set(j, s * (shoulderHalf + 0.04), shY + upperArm + forearm + 0.08, -0.03);
    set(hp, s * hipHalf, hipY);
    set(kn, s * hipHalf, hipY + thigh, -0.02);
    set(an, s * hipHalf, -ankleH);
    set(he, s * hipHalf, 0, 0.05);
    set(to, s * (hipHalf + 0.03), 0, -0.17);
    set(ear, s * 0.075, shY - 0.2, 0.01);
  }
  set(0, 0, shY - 0.19, -0.1);
  return { pts, upperArm, forearm, thigh, shin, shoulderHalf, hipHalf, hipY, shY, side, ankleH };
}

/** Колено двухзвенной ноги от таза H к щиколотке A; колено выводим вперёд (−z), x — по линии ноги. */
function kneeIK(H, A, L1, L2) {
  const dy = A.y - H.y;
  const dz = A.z - H.z;
  const D = Math.min(Math.hypot(dy, dz), L1 + L2 - 1e-4);
  const a = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
  const ang = Math.atan2(dz, dy) - a;
  return {
    x: H.x + (A.x - H.x) * (L1 / (L1 + L2)),
    y: H.y + L1 * Math.cos(ang),
    z: H.z + L1 * Math.sin(ang),
  };
}

/**
 * Выпады со сменой ног (1 цикл = 1 повтор): шаг правой вперёд → опуститься (заднее колено к полу) →
 * встать → шаг назад; то же левой. Руки на поясе, корпус вертикально, пятка задней ноги поднимается.
 */
function lunges(body, n) {
  const STEP = 0.62;
  const legs = {
    left: { hp: 23, kn: 25, an: 27, he: 29, to: 31, sh: 11, el: 13, wr: 15, fingers: [17, 19, 21] },
    right: { hp: 24, kn: 26, an: 28, he: 30, to: 32, sh: 12, el: 14, wr: 16, fingers: [18, 20, 22] },
  };
  const L1 = body.thigh;
  const L2 = body.shin;
  let maxDrop = 0;
  const pose = (frontSide, stepK, depth) => {
    const F = legs[frontSide];
    const B = legs[frontSide === 'left' ? 'right' : 'left'];
    const hipZ = -STEP * 0.46 * stepK;
    const drop = depth * maxDrop;
    const pts = body.pts.map((p) => ({ ...p }));
    for (const p of pts) {
      if (p.y < body.hipY + 0.01) {
        p.y += drop;
        p.z += hipZ;
      }
    }
    // Передняя нога: шаг вперёд с небольшим подъёмом стопы.
    const lift = 0.06 * Math.sin(Math.PI * stepK) * (1 - depth);
    const fA = { x: body.pts[F.an].x, y: -body.ankleH - lift, z: -STEP * stepK };
    pts[F.an] = fA;
    pts[F.he] = { x: fA.x, y: -lift, z: fA.z + 0.05 };
    pts[F.to] = { x: fA.x + Math.sign(fA.x) * 0.03, y: -lift, z: fA.z - 0.17 };
    pts[F.kn] = kneeIK(pts[F.hp], fA, L1, L2);
    // Задняя нога: на месте, пятка поднимается с глубиной.
    const bA = { x: body.pts[B.an].x, y: -body.ankleH - 0.09 * depth, z: 0.02 };
    pts[B.an] = bA;
    pts[B.he] = { x: bA.x, y: -0.09 * depth, z: bA.z + 0.05 };
    pts[B.to] = { x: bA.x, y: 0, z: bA.z - 0.15 };
    pts[B.kn] = kneeIK(pts[B.hp], bA, L1, L2);
    // Руки на поясе: ладони лежат на гребнях таза (чуть выше и снаружи тазобедренного сустава),
    // пальцы смотрят вперёд-вниз, локти отведены в стороны и немного назад.
    for (const S of [F, B]) {
      const s = Math.sign(pts[S.sh].x);
      const hip = pts[S.hp];
      pts[S.wr] = { x: hip.x + s * 0.085, y: hip.y - 0.1, z: hip.z + 0.015 };
      pts[S.el] = {
        x: pts[S.sh].x + s * 0.17,
        y: (pts[S.sh].y + pts[S.wr].y) / 2 + 0.01,
        z: pts[S.sh].z + 0.085,
      };
      for (const j of S.fingers)
        pts[j] = { x: pts[S.wr].x - s * 0.025, y: pts[S.wr].y + 0.035, z: pts[S.wr].z - 0.085 };
    }
    return pts;
  };
  // Глубина: заднее колено в ~7 см от пола.
  let lo = 0;
  let hi = 0.8;
  for (let i = 0; i < 40; i += 1) {
    maxDrop = (lo + hi) / 2;
    const p = pose('right', 1, 1);
    if (p[legs.left.kn].y > -0.07) hi = maxDrop;
    else lo = maxDrop;
  }
  maxDrop = lo;
  return Array.from({ length: n }, (_, k) => {
    const u = (k / n) * 2;
    const side = u < 1 ? 'right' : 'left';
    const v = u % 1;
    // 0–0.22 шаг вперёд, 0.22–0.5 вниз, 0.5–0.75 вверх, 0.75–1 шаг назад.
    const stepK = v < 0.22 ? smooth01(v / 0.22) : v < 0.75 ? 1 : 1 - smooth01((v - 0.75) / 0.25);
    const depth =
      v < 0.22 ? 0 : v < 0.5 ? smooth01((v - 0.22) / 0.28) : v < 0.75 ? 1 - smooth01((v - 0.5) / 0.25) : 0;
    return pose(side, stepK, depth);
  });
}

/** Тайминг повтора: вниз, пауза внизу, вверх (быстрее), пауза вверху. */
function tempo(u, down = 0.42, hold = 0.1, upT = 0.33) {
  if (u < down) return smooth01(u / down);
  if (u < down + hold) return 1;
  if (u < down + hold + upT) return 1 - smooth01((u - down - hold) / upT);
  return 0;
}

/** Прямая рука из плеча под углом ang от вертикали вниз, в плоскости тела (через сторону). */
function straightArm(pts, body, sh, el, wr, extra, ang) {
  const s = Math.sign(pts[sh].x) || 1;
  const S = pts[sh];
  const dir = { x: s * Math.sin(ang), y: Math.cos(ang) };
  const at = (len) => ({ x: S.x + dir.x * len, y: S.y + dir.y * len, z: S.z });
  pts[el] = at(body.upperArm);
  pts[wr] = at(body.upperArm + body.forearm);
  for (const j of extra) pts[j] = at(body.upperArm + body.forearm + 0.08);
}

/** Плечи чуть поднимаются, когда руки над головой — как у живого человека. */
function shrug(pts, k) {
  for (const i of [11, 12]) pts[i] = { ...pts[i], y: pts[i].y - 0.035 * k };
}

/**
 * «Звёздочка» с идеальной техникой: два прыжка за цикл (наружу и внутрь) с отрывом от пола,
 * ноги шире плеч, носки врозь, прямые руки через стороны почти до хлопка, мягкое приземление.
 */
function jumpingJack(body, n) {
  const OUT = 0.34; // насколько каждая стопа уходит в сторону, м
  const HOP = 0.09; // высота прыжка, м
  return Array.from({ length: n }, (_, k) => {
    const u = k / n;
    // 0–0.38 прыжок наружу, 0.38–0.5 приземление широко, 0.5–0.88 прыжок внутрь, 0.88–1 приземление узко.
    const inOut = u < 0.5 ? smooth01(u / 0.38) : 1 - smooth01((u - 0.5) / 0.38);
    const flight =
      u < 0.38
        ? Math.sin((Math.PI * u) / 0.38)
        : u >= 0.5 && u < 0.88
          ? Math.sin((Math.PI * (u - 0.5)) / 0.38)
          : 0;
    const land =
      u >= 0.38 && u < 0.5
        ? Math.sin((Math.PI * (u - 0.38)) / 0.12)
        : u >= 0.88
          ? Math.sin((Math.PI * (u - 0.88)) / 0.12)
          : 0;
    const up = HOP * flight;
    const dip = 0.05 * land; // амортизация
    const pts = body.pts.map((p) => ({ ...p, y: p.y - up + (p.y < body.hipY + 0.01 ? dip : 0) }));
    for (const [hp, kn, an, he, to] of [
      [23, 25, 27, 29, 31],
      [24, 26, 28, 30, 32],
    ]) {
      const s = Math.sign(body.pts[hp].x);
      const ax = body.pts[hp].x + s * OUT * inOut;
      const H = pts[hp];
      pts[an] = { x: ax, y: -body.ankleH - up, z: 0 };
      pts[he] = { x: ax, y: -up, z: 0.05 };
      pts[to] = { x: ax + s * (0.04 + 0.05 * inOut), y: -up, z: -0.16 };
      pts[kn] = { x: (H.x + ax) / 2 + s * 0.015, y: (H.y + pts[an].y) / 2, z: -0.02 - 0.08 * land };
    }
    shrug(pts, inOut);
    const ang = ((10 + 162 * inOut) * Math.PI) / 180;
    straightArm(pts, body, 11, 13, 15, [17, 19, 21], ang);
    straightArm(pts, body, 12, 14, 16, [18, 20, 22], ang);
    return pts;
  });
}

/** Подъём прямых рук через стороны: вверх, пауза наверху, медленно вниз, пауза внизу. */
function armRaise(body, n) {
  return Array.from({ length: n }, (_, k) => {
    const w = tempo(k / n, 0.38, 0.12, 0.38);
    const ang = ((12 + 160 * w) * Math.PI) / 180;
    const pts = body.pts.map((p) => ({ ...p }));
    shrug(pts, w * w);
    straightArm(pts, body, 11, 13, 15, [17, 19, 21], ang);
    straightArm(pts, body, 12, 14, 16, [18, 20, 22], ang);
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
  if (exercise === 'squat') stand = motion[0];
}

const body = canonical(stand);
out.jumping_jack = pack(
  jumpingJack(body, FRAMES),
  1150,
  'кинематика на пропорциях человека из записи приседа',
);
out.lunge = pack(lunges(body, FRAMES * 2), 5600, 'кинематика: правая + левая нога = 1 повтор');
out.arm_raise = pack(armRaise(body, FRAMES), 2600, 'кинематика: прямые руки через стороны');
// Бёрпи — по спецификации движения (motion-specs/burpee.json, разбор ролика покадрово).
const burpee = JSON.parse(readFileSync(resolve(root, 'motion-specs/burpee.json'), 'utf8'));
out.burpee = pack(specMotion(burpee, body, 240), burpee.cycle_ms, 'motion-specs/burpee.json');
// Эталоны из записи движения (как присед): позы MediaPipe по роликам упражнений, motion-specs/poses/<id>.json.
// ms — один проход ролика (для mirror — одна сторона), near — ближняя к камере сторона бокового ролика.
const VIDEO = {
  side_lunge: { ms: 2400, mirror: true },
  boxing: { ms: 1200, mirror: true },
  arm_circles: { ms: 3200, smoothK: 2 },
  side_bend: { ms: 2600, mirror: true },
  side_leg_raise: { ms: 2200, mirror: true, smoothK: 2 },
  plank: { ms: 4000, near: 'right', prone: true, trim: [0.12, 0.88], smoothK: 6 },
  calf_raise: { ms: 3000, near: 'right' },
  jump_squat: { ms: 3200, jump: true, smoothK: 2 },
};
for (const [id, opts] of Object.entries(VIDEO)) {
  const data = JSON.parse(readFileSync(resolve(root, `motion-specs/poses/${id}.json`), 'utf8'));
  const m = videoMotion(data, opts);
  out[id] = pack(m.frames, m.durationMs, `motion-specs/poses/${id}.json`);
}
// По спецификации (3D-кинематика): локоть к колену — в ролике лёжа, а у нас стоя; отжимания — на боковом
// ролике MediaPipe занижает плечи внизу (тело уходит под пол), углы спецификации сверены с тем же роликом.
for (const id of ['knee_to_elbow', 'push_up']) {
  const spec = JSON.parse(readFileSync(resolve(root, `motion-specs/${id}.json`), 'utf8'));
  out[id] = pack(
    spec3dMotion(spec, body, Math.round(spec.cycle_ms / 25)),
    spec.cycle_ms,
    `motion-specs/${id}.json`,
  );
}

const target = resolve(root, 'src/ui/lib/athleteMotion.json');
writeFileSync(target, JSON.stringify(out));
console.log('→', target, `${(JSON.stringify(out).length / 1024).toFixed(1)} KB`);
