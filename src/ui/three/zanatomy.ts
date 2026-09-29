// Анатомический атлет на модели Z-Anatomy (CC BY-SA 4.0, на основе BodyParts3D, CC BY-SA 2.1 JP).
// Модель подготовлена scripts/blender/prep-zanatomy.py: мышцы и видимые кости упрощены, подсвечиваемые
// мышечные группы — отдельные меши по сторонам (quads_l, glutes_r, ...), суставы — в zanatomyJoints.json.
//
// Скелета в модели нет — строим его сами: веса вершин считаем при загрузке по расстоянию до сегментов
// костей (голень, бедро, плечо...), а каждый кадр ставим кости по 3D-точкам движения (lib/athlete.ts):
// поворот + растяжение сегмента под длину (у человека из записи другие пропорции, чем у модели).

import {
  Bone,
  BufferAttribute,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Skeleton,
  SkinnedMesh,
  Vector3,
  CircleGeometry,
  CanvasTexture,
  DoubleSide,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MUSCLES, activation, athleteBounds, type GhostId, type Muscle } from '../lib/athlete';
import { sharedRenderer, blitTo } from './renderer';
import J from './zanatomyJoints.json';

type V3 = { x: number; y: number; z: number };
type JointName = keyof typeof J;

import { isMobileDevice } from '../../engine/perf';

/** Телефону — облегчённая модель (~3× меньше треугольников). */
const MODEL_URL = `${import.meta.env.BASE_URL}models/${isMobileDevice() ? 'athlete-lite' : 'athlete'}.glb`;

// ——— Кости ———

interface BoneDef {
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

const BONES: BoneDef[] = [
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

const jv = (n: JointName) => new Vector3(...(J[n] as [number, number, number]));
const mid = (a: Vector3, b: Vector3) => a.clone().add(b).multiplyScalar(0.5);

/** Опорные точки торса в покое. */
const REST = (() => {
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
function skinGeometry(geo: BufferGeometry, part: string): void {
  // Дельта целиком едет с плечом: штрафы «торса» (подмышка, лопатка) к ней не относятся — иначе задний
  // пучок остаётся на лопатке и свисает лоскутом при поднятых руках.
  const delt = part.startsWith('delts');
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const B = BONES.length;
  const segs = BONES.map(restSegment);
  const p = new Vector3();
  const d = new Float32Array(B);
  let W = new Float32Array(n * B);
  for (let v = 0; v < n; v += 1) {
    p.fromBufferAttribute(pos, v);
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
    const k = `${Math.round(pos.getX(v) * 2000)},${Math.round(pos.getY(v) * 2000)},${Math.round(pos.getZ(v) * 2000)}`;
    const r = key.get(k);
    if (r === undefined) {
      key.set(k, v);
      rep[v] = v;
    } else rep[v] = r;
  }
  const index = geo.getIndex();
  const nb: number[][] = Array.from({ length: n }, () => []);
  const tri = index ? index.count : n;
  for (let i = 0; i < tri; i += 3) {
    const a = rep[index ? index.getX(i) : i]!;
    const b = rep[index ? index.getX(i + 1) : i + 1]!;
    const c = rep[index ? index.getX(i + 2) : i + 2]!;
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
  geo.setAttribute('skinIndex', new BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new BufferAttribute(wts, 4));
}

// ——— Загрузка модели (один раз) ———

interface Model {
  parts: { name: string; geo: BufferGeometry }[];
}
let modelPromise: Promise<Model> | null = null;

export function loadModel(): Promise<Model> {
  modelPromise ??= new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    const parts: Model['parts'] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const geo = m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);
      geo.deleteAttribute('uv');
      skinGeometry(geo, m.name);
      parts.push({ name: m.name, geo });
    });
    return { parts };
  });
  return modelPromise;
}

// ——— Материалы ———

const SKIN = new MeshStandardMaterial({
  color: new Color('#bcc2cb'),
  roughness: 0.46,
  metalness: 0.04,
  side: DoubleSide,
});
const BONE = new MeshStandardMaterial({
  color: new Color('#d8d0bf'),
  roughness: 0.62,
  metalness: 0,
  side: DoubleSide,
});
const ERROR = new MeshStandardMaterial({
  color: new Color('#ef4444'),
  roughness: 0.4,
  emissive: new Color('#ff2020'),
  emissiveIntensity: 0.5,
});

function muscleMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color('#e2483c'),
    roughness: 0.42,
    metalness: 0.02,
    emissive: new Color('#ff2a14'),
    emissiveIntensity: 0.2,
    side: DoubleSide,
  });
}

function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.6)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}
let shadowTex: CanvasTexture | null = null;

/** Группа меша → мышца и сторона для подсчёта нагрузки. */
function muscleOf(part: string): { muscle: Muscle | 'pecs'; act: string } | null {
  const [g, side] = part.split('_') as [string, string | undefined];
  const S = side === 'l' ? 'L' : 'R';
  switch (g) {
    case 'quads':
    case 'hamstrings':
      return { muscle: g, act: `quads${S}` };
    case 'delts':
      return { muscle: 'delts', act: `delts${S}` };
    case 'glutes':
    case 'adductors':
    case 'calves':
    case 'traps':
    case 'abductors':
      return { muscle: g, act: g };
    case 'pecs':
      return { muscle: 'pecs', act: 'pecs' };
    default:
      return null;
  }
}

/** Какие суставы (данные) закрывает подсветка ошибки для группы меша. */
const PART_JOINTS: Record<string, [number, number]> = {
  quads_l: [23, 25],
  quads_r: [24, 26],
  hamstrings_l: [23, 25],
  hamstrings_r: [24, 26],
  adductors_l: [23, 25],
  adductors_r: [24, 26],
  calves_l: [25, 27],
  calves_r: [26, 28],
  delts_l: [11, 13],
  delts_r: [12, 14],
};

// ——— Разворот ладоней ———

const DOWN = new Vector3(0, -1, 0);
/** Какую долю скручивания берёт сегмент: плечо — частично (ротация в плечевом суставе), предплечье и кисть — всё. */
const TWIST_SHARE: Record<string, number> = { arm: 0.35, forearm: 1, hand: 1 };

/**
 * Поворот вокруг оси сегмента, после которого ладонь смотрит туда, куда смотрит у человека:
 * рука горизонтально (вперёд или в сторону) — вниз; рука вертикально (вдоль тела, на поясе, над головой) —
 * к середине тела.
 */
function palmTwist(b: BoneDef, R: Matrix4, dir: Vector3, center: Vector3, i: number): Matrix4 {
  void i;
  const share = TWIST_SHARE[b.name.split('.')[0]!] ?? 0;
  if (!share) return new Matrix4();
  const side = b.name.endsWith('.l') ? 1 : -1;
  const palm = new Vector3(0, 0, 1).applyMatrix4(new Matrix4().extractRotation(R)); // в покое — вперёд
  const horiz = Math.sqrt(Math.max(0, 1 - dir.y * dir.y)); // 1 — рука горизонтально
  const inward = new Vector3(-side, 0, 0); // к середине тела (модель: левая сторона — +x)
  void center;
  const want = DOWN.clone()
    .multiplyScalar(horiz)
    .add(inward.multiplyScalar(1 - horiz));
  const proj = (v: Vector3) =>
    v
      .clone()
      .sub(dir.clone().multiplyScalar(v.dot(dir)))
      .normalize();
  const a = proj(palm);
  const w = proj(want);
  if (!Number.isFinite(a.x) || !Number.isFinite(w.x) || a.lengthSq() < 0.5 || w.lengthSq() < 0.5)
    return new Matrix4();
  let ang = Math.atan2(new Vector3().crossVectors(a, w).dot(dir), a.dot(w));
  ang *= share;
  return new Matrix4().makeRotationAxis(dir, ang);
}

// ——— Вид ———

export class ZAthleteView {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(24, 1, 0.1, 50);
  private readonly group = new Group();
  private readonly bones = BONES.map(() => new Bone());
  private readonly skeleton = new Skeleton(
    this.bones,
    BONES.map(() => new Matrix4()),
  );
  private readonly meshes: { mesh: SkinnedMesh; part: string; mat: MeshStandardMaterial | null }[] = [];
  private ready = false;
  private readonly headMesh = new Mesh(new SphereGeometry(1, 28, 20), SKIN);
  private readonly neckMesh = new Mesh(new SphereGeometry(1, 20, 14), SKIN);

  constructor(readonly exercise: GhostId) {
    this.scene.add(new HemisphereLight('#ffffff', '#0f172a', 0.7));
    const key = new DirectionalLight('#ffffff', 1.9);
    key.position.set(1.6, 3.2, 3.4);
    const fill = new DirectionalLight('#9cc8ff', 0.55);
    fill.position.set(-2.4, 1.2, 2);
    const rim = new DirectionalLight('#fb923c', 2.4);
    rim.position.set(-1.8, 2.4, -2.8);
    this.scene.add(key, fill, rim, this.group);
    shadowTex ??= shadowTexture();
    const shadow = new Mesh(
      new CircleGeometry(1, 32),
      new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(0.55, 0.32, 1);
    shadow.position.y = 0.002;
    this.scene.add(shadow);
    for (const b of this.bones) {
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
    }
    for (const m of [this.headMesh, this.neckMesh]) {
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }

    const active = new Set<string>(MUSCLES[exercise]);
    void loadModel().then((model) => {
      for (const { name, geo } of model.parts) {
        const m = muscleOf(name);
        const on = !!m && active.has(m.muscle);
        const mat = on ? muscleMaterial() : null;
        const mesh = new SkinnedMesh(geo, mat ?? (name === 'bones' ? BONE : SKIN));
        mesh.bindMode = 'detached';
        mesh.bind(this.skeleton, new Matrix4());
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.meshes.push({ mesh, part: name, mat });
      }
      this.ready = true;
    });
  }

  render(
    target: CanvasRenderingContext2D,
    W: number,
    H: number,
    pose: (V3 | null)[],
    opts: { yaw: number; mobile: boolean; highlight?: ReadonlySet<number> },
  ): boolean {
    if (!this.ready) return false;
    const r = sharedRenderer(opts.mobile);
    if (!r) return false;
    if (!this.pose(pose, opts.highlight)) return false;
    this.group.rotation.y = -opts.yaw;
    this.fit(W / H);
    return blitTo(r, this.scene, this.camera, target, W, H);
  }

  private fit(aspect: number): void {
    const b = athleteBounds(this.exercise);
    const cam = this.camera;
    cam.aspect = aspect;
    const vfov = (cam.fov * Math.PI) / 180;
    const distH = (b.h * 1.08) / 2 / Math.tan(vfov / 2);
    const distW = (b.w * 1.02) / 2 / (Math.tan(vfov / 2) * aspect);
    cam.position.set(0, b.h * 0.5, Math.max(distH, distW));
    cam.lookAt(0, b.h * 0.47, 0);
    cam.updateProjectionMatrix();
  }

  /** Ставит кости по позе: поворот + растяжение сегментов, торс — по базису плеч и таза. */
  private pose(pose: (V3 | null)[], highlight?: ReadonlySet<number>): boolean {
    // Данные: y вниз, лицом к зрителю −z → three: Y вверх, к камере +Z.
    const P = (i: number) => {
      const p = pose[i];
      return p ? new Vector3(p.x, -p.y, -p.z) : null;
    };
    const ls = P(11);
    const rs = P(12);
    const lh = P(23);
    const rh = P(24);
    if (!ls || !rs || !lh || !rh) return false;
    const hipMid = mid(lh, rh);
    const shMid = mid(ls, rs);

    const basis = (right: Vector3, upRaw: Vector3) => {
      const x = right.clone().normalize();
      const y = upRaw
        .clone()
        .sub(x.clone().multiplyScalar(upRaw.dot(x)))
        .normalize();
      const z = new Vector3().crossVectors(x, y);
      return new Matrix4().makeBasis(x, y, z);
    };
    const restPelvis = basis(jv('hip.r').sub(jv('hip.l')), REST.shMid.clone().sub(REST.hipMid));
    const restChest = basis(jv('shoulder.r').sub(jv('shoulder.l')), REST.shMid.clone().sub(REST.hipMid));
    const tPelvis = basis(rh.clone().sub(lh), shMid.clone().sub(hipMid));
    const tChest = basis(rs.clone().sub(ls), shMid.clone().sub(hipMid));
    const rot = (target: Matrix4, rest: Matrix4) => target.clone().multiply(rest.clone().transpose());
    const rigid = (from: Vector3, to: Vector3, R: Matrix4) =>
      new Matrix4()
        .makeTranslation(to.x, to.y, to.z)
        .multiply(R)
        .multiply(new Matrix4().makeTranslation(-from.x, -from.y, -from.z));

    const Rp = rot(tPelvis, restPelvis);
    const Rc = rot(tChest, restChest);
    // Голова: вслед за грудью, наклон — по направлению шея → голова.
    const le = P(7);
    const re = P(8);
    const headT =
      le && re
        ? mid(le, re).add(new Vector3(0, 0.02, 0))
        : (P(0) ?? shMid.clone().add(new Vector3(0, 0.25, 0)));
    const neckT = shMid.clone().add(headT.clone().sub(shMid).multiplyScalar(0.35));
    const headDir0 = REST.head
      .clone()
      .sub(REST.neck)
      .applyMatrix4(new Matrix4().extractRotation(Rc))
      .normalize();
    const headDir = headT.clone().sub(neckT).normalize();
    const Rh = new Matrix4()
      .makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(headDir0, headDir))
      .multiply(Rc);

    BONES.forEach((b, i) => {
      let M: Matrix4;
      if (b.kind === 'pelvis') M = rigid(REST.hipMid, hipMid, Rp);
      else if (b.kind === 'chest') M = rigid(REST.shMid, shMid, Rc);
      else if (b.kind === 'head') M = rigid(REST.neck, neckT, Rh);
      else {
        const A0 = jv(b.a);
        const B0 = jv(b.b);
        const A = P(b.ia);
        const B = P(b.ib);
        if (!A || !B) {
          M = rigid(A0, A0, new Matrix4());
        } else {
          const d0 = B0.clone().sub(A0);
          const d = B.clone().sub(A);
          const k = d.length() / d0.length();
          const n = d0.clone().normalize();
          // Растяжение вдоль кости: S = I + (k − 1)·n·nᵀ.
          const S = new Matrix4().set(
            1 + (k - 1) * n.x * n.x,
            (k - 1) * n.x * n.y,
            (k - 1) * n.x * n.z,
            0,
            (k - 1) * n.y * n.x,
            1 + (k - 1) * n.y * n.y,
            (k - 1) * n.y * n.z,
            0,
            (k - 1) * n.z * n.x,
            (k - 1) * n.z * n.y,
            1 + (k - 1) * n.z * n.z,
            0,
            0,
            0,
            0,
            1,
          );
          // Поворот: сначала вместе с торсом (без «скручивания»), потом кратчайшая дуга до цели.
          const Rt = i >= 9 ? Rc : Rp;
          const d0t = n.clone().applyMatrix4(new Matrix4().extractRotation(Rt)).normalize();
          const R = new Matrix4()
            .makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(d0t, d.clone().normalize()))
            .multiply(Rt);
          if (i >= 9) R.premultiply(palmTwist(b, R, d.clone().normalize(), shMid, i));
          M = new Matrix4()
            .makeTranslation(A.x, A.y, A.z)
            .multiply(R)
            .multiply(S)
            .multiply(new Matrix4().makeTranslation(-A0.x, -A0.y, -A0.z));
        }
      }
      this.bones[i]!.matrixWorld.copy(M);
      if (b.kind === 'head') {
        // Голова: эллипсоид на месте черепа, шея — от C7 к основанию черепа.
        const hc = REST.head.clone().add(new Vector3(0, 0.005, 0.005));
        this.headMesh.matrix
          .copy(M)
          .multiply(new Matrix4().makeTranslation(hc.x, hc.y, hc.z))
          .multiply(new Matrix4().makeScale(0.078, 0.104, 0.092));
        const nc = REST.neck
          .clone()
          .lerp(REST.head, 0.48)
          .add(new Vector3(0, 0, -0.014)); // шея чуть за подбородком — без «воротника»
        this.neckMesh.matrix
          .copy(M)
          .multiply(new Matrix4().makeTranslation(nc.x, nc.y, nc.z))
          .multiply(new Matrix4().makeScale(0.048, 0.08, 0.05));
      }
    });

    const act = activation(this.exercise, pose) as Record<string, number>;
    for (const m of this.meshes) {
      const js = PART_JOINTS[m.part];
      const hl = !!highlight && !!js && highlight.has(js[0]) && highlight.has(js[1]);
      if (m.mat) {
        const mm = muscleOf(m.part)!;
        const load = act[mm.act] ?? 0;
        m.mat.emissiveIntensity = 0.08 + 0.6 * load;
        m.mat.color.setRGB(0.72 + 0.2 * load, 0.2 + 0.06 * (1 - load), 0.16);
      }
      m.mesh.material = hl ? ERROR : (m.mat ?? (m.part === 'bones' ? BONE : SKIN));
    }
    return true;
  }
}
