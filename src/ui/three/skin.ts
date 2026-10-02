// Скелет анатомического атлета и веса вершин (какие кости двигают каждую вершину модели). Отдельный модуль
// без DOM: веса считаются в фоновом потоке (skin.worker.ts) — на полной модели это секунды работы, и на
// основном потоке страница замирала.

import { Vector3 } from 'three';
import J from './zanatomyJoints.json';

type JointName = keyof typeof J;

/** Четыре кости на вершину и их веса. */
export interface SkinWeights {
  idx: Uint16Array;
  wts: Float32Array;
}

/** Меняется вместе с логикой весов — сохранённые в браузере веса старой версии не берём. */
export const SKIN_VERSION = 1;

// ——— Кости ———

export interface BoneDef {
  name: string;
  /** Сегмент в покое (модель): от сустава a к b. */
  a: JointName;
  b: JointName;
  /** Те же суставы в данных движения (индексы MediaPipe). */
  ia: number;
  ib: number;
  /** Радиус «капсулы» для весов, м. */
  r: number;
  kind: 'limb' | 'pelvis' | 'chest' | 'head';
}

export const BONES: BoneDef[] = [
  { name: 'pelvis', a: 'hip.l', b: 'hip.r', ia: 23, ib: 24, r: 0.13, kind: 'pelvis' },
  { name: 'chest', a: 'shoulder.l', b: 'shoulder.r', ia: 11, ib: 12, r: 0.15, kind: 'chest' },
  { name: 'head', a: 'neck', b: 'head', ia: -1, ib: -1, r: 0.1, kind: 'head' },
  { name: 'thigh.l', a: 'hip.l', b: 'knee.l', ia: 23, ib: 25, r: 0.085, kind: 'limb' },
  { name: 'thigh.r', a: 'hip.r', b: 'knee.r', ia: 24, ib: 26, r: 0.085, kind: 'limb' },
  { name: 'shin.l', a: 'knee.l', b: 'ankle.l', ia: 25, ib: 27, r: 0.06, kind: 'limb' },
  { name: 'shin.r', a: 'knee.r', b: 'ankle.r', ia: 26, ib: 28, r: 0.06, kind: 'limb' },
  { name: 'foot.l', a: 'ankle.l', b: 'toe.l', ia: 27, ib: 31, r: 0.045, kind: 'limb' },
  { name: 'foot.r', a: 'ankle.r', b: 'toe.r', ia: 28, ib: 32, r: 0.045, kind: 'limb' },
  { name: 'arm.l', a: 'shoulder.l', b: 'elbow.l', ia: 11, ib: 13, r: 0.055, kind: 'limb' },
  { name: 'arm.r', a: 'shoulder.r', b: 'elbow.r', ia: 12, ib: 14, r: 0.055, kind: 'limb' },
  { name: 'forearm.l', a: 'elbow.l', b: 'wrist.l', ia: 13, ib: 15, r: 0.045, kind: 'limb' },
  { name: 'forearm.r', a: 'elbow.r', b: 'wrist.r', ia: 14, ib: 16, r: 0.045, kind: 'limb' },
  { name: 'hand.l', a: 'wrist.l', b: 'hand.l', ia: 15, ib: 19, r: 0.035, kind: 'limb' },
  { name: 'hand.r', a: 'wrist.r', b: 'hand.r', ia: 16, ib: 20, r: 0.035, kind: 'limb' },
];

export const jv = (n: JointName) => new Vector3(...(J[n] as [number, number, number]));
export const mid = (a: Vector3, b: Vector3) => a.clone().add(b).multiplyScalar(0.5);

/** Опорные точки торса в покое. */
export const REST = (() => {
  const hipMid = mid(jv('hip.l'), jv('hip.r'));
  const shMid = mid(jv('shoulder.l'), jv('shoulder.r'));
  return { hipMid, shMid, neck: jv('neck'), head: jv('head') };
})();

/** Сегмент «кости» в покое для весов: торс — вертикальные отрезки по центру. */
function restSegment(b: BoneDef): [Vector3, Vector3] {
  if (b.kind === 'pelvis')
    return [REST.hipMid.clone().add(new Vector3(0, -0.05, 0)), REST.hipMid.clone().lerp(REST.shMid, 0.45)];
  if (b.kind === 'chest') return [REST.hipMid.clone().lerp(REST.shMid, 0.55), REST.shMid.clone()];
  if (b.kind === 'head') return [REST.neck.clone(), REST.head.clone().add(new Vector3(0, 0.08, 0))];
  return [jv(b.a), jv(b.b)];
}

function distToSegment(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
}

/**
 * Подмышка: вершины внутри туловища (медиальнее плечевого сустава) и ниже него рука не двигает совсем —
 * иначе широчайшая и грудные натягиваются перепонкой между рукой и боком.
 */
function armExcluded(p: Vector3, b: BoneDef): boolean {
  if (!(b.name.startsWith('arm') || b.name.startsWith('forearm') || b.name.startsWith('hand'))) return false;
  const s = b.name.endsWith('.l') ? 'l' : 'r';
  const side = s === 'l' ? 1 : -1;
  const shoulder = jv(`shoulder.${s}`);
  const inward = (shoulder.x - p.x) * side;
  if (inward <= 0) return false;
  // Рука висит вплотную к телу: её внутреннюю поверхность не трогаем. Исключаем только то, что заметно
  // дальше от оси плеча, чем толщина самой руки, — это уже бок туловища.
  return distToSegment(p, shoulder, jv(`elbow.${s}`)) > 0.065 && p.y < shoulder.y - 0.02;
}

/**
 * Штраф для верхних сегментов рук и ног: вершина ближе к середине тела, чем сустав (плечо, таз), —
 * это торс (широчайшие, грудные, косые), а не конечность.
 */
function medialPenalty(p: Vector3, b: BoneDef): number {
  if (b.kind !== 'limb') return 0;
  const arm = b.name.startsWith('arm') || b.name.startsWith('forearm') || b.name.startsWith('hand');
  const thigh = b.name.startsWith('thigh');
  if (!arm && !thigh) return 0;
  const side = b.name.endsWith('.l') ? 1 : -1;
  // Для всей руки граница — плечевой сустав: всё, что ближе к середине тела, — торс
  // (широчайшие, грудные, косые, зубчатая), иначе они тянутся за рукой «крыльями».
  const joint = jv(arm ? (side > 0 ? 'shoulder.l' : 'shoulder.r') : b.a);
  const inward = (joint.x - p.x) * side;
  // Бедро: к тазу — только то, что медиальнее и ВЫШЕ сустава (живот, паховая связка). Приводящие ниже сустава
  // — мышцы бедра: иначе при сгибе на 90° (выпад) они растягиваются по паху плоскими лоскутами.
  if (thigh) return inward > 0.005 && p.y > joint.y - 0.02 ? inward * 1.5 : 0;
  // Лопатка: задние мышцы на уровне плеча (подостная, большая круглая, широчайшая), если они не снаружи
  // сустава, остаются с грудной клеткой — иначе при руке вперёд / локтях назад вылезают лоскуты.
  const behind = joint.z - p.z; // в модели лицом к +Z
  const nearShoulder = Math.abs(p.y - joint.y) < 0.18 && inward > -0.03;
  const back = nearShoulder && behind > 0.02 ? behind * 3 : 0;
  if (inward <= 0.005) return back;
  const below = Math.max(0, joint.y - p.y);
  return inward * 4 + below * 1.2 + back;
}

/** Сколько раз усредняем веса с соседями по рёбрам сетки и насколько сильно. */
const SMOOTH_ITERS = 10;
const SMOOTH_K = 0.6;

/**
 * Веса вершин. Сначала — по расстоянию до сегментов костей (две ближайшие кости, ~1/d⁴). Потом веса
 * сглаживаются по поверхности: несколько раз усредняем с соседями по рёбрам, внутри каждой мышцы.
 * Переход между костями растягивается вдоль мышцы на несколько сантиметров — широчайшая или грудная
 * тянется плавно, как у живого человека, а не складывается острой «перепонкой».
 */
export function computeSkin(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  part: string,
): SkinWeights {
  // Дельта целиком едет с плечом: штрафы «торса» (подмышка, лопатка) к ней не относятся — иначе задний
  // пучок остаётся на лопатке и свисает лоскутом при поднятых руках.
  const delt = part.startsWith('delts');
  const n = positions.length / 3;
  const px = (v: number) => positions[v * 3]!;
  const py = (v: number) => positions[v * 3 + 1]!;
  const pz = (v: number) => positions[v * 3 + 2]!;
  const B = BONES.length;
  const segs = BONES.map(restSegment);
  const p = new Vector3();
  const d = new Float32Array(B);
  let W = new Float32Array(n * B);
  for (let v = 0; v < n; v += 1) {
    p.set(px(v), py(v), pz(v));
    for (let i = 0; i < B; i += 1) {
      const [a, b] = segs[i]!;
      d[i] = delt
        ? Math.max(0.004, distToSegment(p, a, b) - BONES[i]!.r * 0.6)
        : armExcluded(p, BONES[i]!)
          ? 1e3
          : Math.max(0.004, distToSegment(p, a, b) - BONES[i]!.r * 0.6 + medialPenalty(p, BONES[i]!));
    }
    let b1 = 0;
    let b2 = 1;
    for (let i = 0; i < B; i += 1) {
      if (d[i]! < d[b1]!) {
        b2 = b1;
        b1 = i;
      } else if (i !== b1 && (b2 === b1 || d[i]! < d[b2]!)) b2 = i;
    }
    const w1 = 1 / d[b1]! ** 4;
    const w2 = 1 / d[b2]! ** 4;
    W[v * B + b1] = w1 / (w1 + w2);
    W[v * B + b2] = w2 / (w1 + w2);
  }

  // Соседи по рёбрам; вершины в одной точке (швы нормалей) склеиваем — иначе сглаживание рвётся по шву.
  const key = new Map<string, number>();
  const rep = new Int32Array(n);
  for (let v = 0; v < n; v += 1) {
    const k = `${Math.round(px(v) * 2000)},${Math.round(py(v) * 2000)},${Math.round(pz(v) * 2000)}`;
    const r = key.get(k);
    if (r === undefined) {
      key.set(k, v);
      rep[v] = v;
    } else rep[v] = r;
  }
  const nb: number[][] = Array.from({ length: n }, () => []);
  const tri = index ? index.length : n;
  for (let i = 0; i < tri; i += 3) {
    const a = rep[index ? index[i]! : i]!;
    const b = rep[index ? index[i + 1]! : i + 1]!;
    const c = rep[index ? index[i + 2]! : i + 2]!;
    nb[a]!.push(b, c);
    nb[b]!.push(a, c);
    nb[c]!.push(a, b);
  }
  for (let it = 0; it < SMOOTH_ITERS; it += 1) {
    const next = new Float32Array(W);
    for (let v = 0; v < n; v += 1) {
      if (rep[v] !== v) continue;
      const list = nb[v]!;
      if (!list.length) continue;
      for (let bi = 0; bi < B; bi += 1) {
        let s = 0;
        for (const u of list) s += W[u * B + bi]!;
        next[v * B + bi] = W[v * B + bi]! * (1 - SMOOTH_K) + (s / list.length) * SMOOTH_K;
      }
    }
    W = next;
  }

  // Четыре самые сильные кости на вершину (дубликаты на швах берут веса своей «главной» копии).
  const idx = new Uint16Array(n * 4);
  const wts = new Float32Array(n * 4);
  const order = new Int32Array(B);
  for (let v = 0; v < n; v += 1) {
    const src = rep[v]! * B;
    for (let i = 0; i < B; i += 1) order[i] = i;
    const sorted = [...order].sort((x, y) => W[src + y]! - W[src + x]!).slice(0, 4);
    const sum = sorted.reduce((s0, bi) => s0 + W[src + bi]!, 0) || 1;
    sorted.forEach((bi, k) => {
      idx[v * 4 + k] = bi;
      wts[v * 4 + k] = W[src + bi]! / sum;
    });
  }
  return { idx, wts };
}
