// 3D-атлет (three.js) в стиле анатомического атласа: светлое тело из мышечных объёмов,
// работающие мышцы — красные накладки с волокнами, яркость — по нагрузке из позы.
// Движение — те же 3D-точки, что у 2D-версии (lib/athlete.ts): присед из записи человека,
// остальное — кинематика на его пропорциях.
//
// Запасной вариант, пока грузится модель Z-Anatomy (three/zanatomy.ts). Рендерер общий (three/renderer.ts).

import {
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { ExerciseId } from '../../engine/types';
import { MUSCLES, activation, athleteBounds, type Muscle } from '../lib/athlete';
import { blitTo, sharedRenderer } from './renderer';

type V3 = { x: number; y: number; z: number };

// ——— Материалы и геометрии (общие для всех атлетов) ———

function fiberTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d23a2e';
  g.fillRect(0, 0, 64, 128);
  for (let x = 0; x < 64; x += 4) {
    g.fillStyle = x % 8 === 0 ? 'rgba(255, 170, 150, 0.35)' : 'rgba(110, 10, 10, 0.35)';
    g.fillRect(x, 0, 1.5, 128);
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(3, 1);
  t.colorSpace = SRGBColorSpace;
  return t;
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

let shared: {
  skin: MeshStandardMaterial;
  error: MeshStandardMaterial;
  fibers: CanvasTexture;
  shadow: CanvasTexture;
  geo: Record<string, BufferGeometry>;
} | null = null;

/** Профиль конечности: t от сустава A к B, радиус относительно радиуса у A (мышечное «брюшко»). */
function profile(ratio: number, bulge: number, peak: number, t0 = 0, t1 = 1, pad = 1): Vector2[] {
  const pts: Vector2[] = [];
  const f = (t: number) => (1 + (ratio - 1) * t) * (1 + bulge * Math.exp(-(((t - peak) / 0.28) ** 2)));
  const cap = t0 === 0 && t1 === 1;
  if (cap) pts.push(new Vector2(0, -0.06), new Vector2(0.55 * f(0), -0.045), new Vector2(0.85 * f(0), -0.02));
  const N = 16;
  for (let i = 0; i <= N; i += 1) {
    const t = t0 + ((t1 - t0) * i) / N;
    // Накладка мышцы: в середине выпирает (брюшко), к краям уходит под кожу — без резкого края.
    const k = cap ? 1 : 0.94 + (pad - 0.94) * Math.sin((Math.PI * i) / N) ** 0.7;
    pts.push(new Vector2(f(t) * k, t));
  }
  if (cap) pts.push(new Vector2(0.85 * f(1), 1.02), new Vector2(0.55 * f(1), 1.045), new Vector2(0, 1.06));
  return pts;
}

function sharedAssets() {
  if (shared) return shared;
  const fibers = fiberTexture();
  const lathe = (p: Vector2[], seg = 18, phiStart = 0, phiLength = Math.PI * 2) =>
    new LatheGeometry(p, seg, phiStart, phiLength);
  const FRONT = Math.PI * 1.25;
  const BACK = Math.PI * 1.1;
  shared = {
    skin: new MeshStandardMaterial({ color: new Color('#cdd3db'), roughness: 0.58, metalness: 0.02 }),
    error: new MeshStandardMaterial({
      color: new Color('#ef4444'),
      roughness: 0.4,
      emissive: new Color('#ff2222'),
      emissiveIntensity: 0.55,
    }),
    fibers,
    shadow: shadowTexture(),
    geo: {
      thigh: lathe(profile(0.64, 0.14, 0.3)),
      shin: lathe(profile(0.6, 0.2, 0.22)),
      upperArm: lathe(profile(0.74, 0.16, 0.32)),
      forearm: lathe(profile(0.64, 0.16, 0.16)),
      hand: lathe(profile(0.8, 0, 0.5), 10),
      foot: lathe(profile(0.8, 0, 0.5), 10),
      // Накладки мышц (чуть шире сегмента, только нужная сторона и часть длины).
      quads: lathe(profile(0.66, 0.1, 0.32, 0.1, 0.9, 1.09), 20, -FRONT / 2, FRONT),
      hams: lathe(profile(0.66, 0.1, 0.32, 0.12, 0.85, 1.07), 16, Math.PI - BACK / 2, BACK),
      calves: lathe(profile(0.64, 0.14, 0.24, 0.04, 0.62, 1.1), 16, Math.PI - BACK / 2, BACK),
      delts: lathe(profile(0.78, 0.12, 0.3, 0, 0.45, 1.1), 18),
      adductor: lathe(profile(0.66, 0.1, 0.32, 0.05, 0.62, 1.07), 12, Math.PI / 2 - 0.6, 1.2),
      sphere: new SphereGeometry(1, 20, 14),
      capsule: new CapsuleGeometry(1, 1, 6, 16),
      disc: new CircleGeometry(1, 32),
    },
  };
  return shared;
}

// ——— Сборка атлета ———

/** Сегменты конечностей: [A, B, геометрия, радиус у A, м]. */
const LIMBS: [number, number, string, number][] = [
  [23, 25, 'thigh', 0.088],
  [24, 26, 'thigh', 0.088],
  [25, 27, 'shin', 0.06],
  [26, 28, 'shin', 0.06],
  [11, 13, 'upperArm', 0.052],
  [12, 14, 'upperArm', 0.052],
  [13, 15, 'forearm', 0.042],
  [14, 16, 'forearm', 0.042],
  [15, 19, 'hand', 0.03],
  [16, 20, 'hand', 0.03],
  [29, 31, 'foot', 0.04],
  [30, 32, 'foot', 0.04],
];

/** Какая накладка мышцы на каком сегменте. */
const OVERLAYS: { a: number; b: number; muscle: Muscle; geo: string; act: string }[] = [
  { a: 23, b: 25, muscle: 'quads', geo: 'quads', act: 'quadsL' },
  { a: 24, b: 26, muscle: 'quads', geo: 'quads', act: 'quadsR' },
  { a: 23, b: 25, muscle: 'hamstrings', geo: 'hams', act: 'quadsL' },
  { a: 24, b: 26, muscle: 'hamstrings', geo: 'hams', act: 'quadsR' },
  { a: 23, b: 25, muscle: 'adductors', geo: 'adductor', act: 'adductors' },
  { a: 24, b: 26, muscle: 'adductors', geo: 'adductor', act: 'adductors' },
  { a: 25, b: 27, muscle: 'calves', geo: 'calves', act: 'calves' },
  { a: 26, b: 28, muscle: 'calves', geo: 'calves', act: 'calves' },
  { a: 11, b: 13, muscle: 'delts', geo: 'delts', act: 'deltsL' },
  { a: 12, b: 14, muscle: 'delts', geo: 'delts', act: 'deltsR' },
];

interface Seg {
  a: number;
  b: number;
  mesh: Mesh;
  r: number;
  inner?: boolean;
}

interface OverlayMesh extends Seg {
  act: string;
  mat: MeshStandardMaterial;
}

export class AthleteView {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(26, 1, 0.1, 50);
  private readonly body = new Group();
  private readonly segs: Seg[] = [];
  private readonly overlays: OverlayMesh[] = [];
  private readonly blobs: {
    mesh: Mesh;
    mat: MeshStandardMaterial;
    act: string;
    kind: string;
    side: number;
  }[] = [];
  private readonly torso: Record<string, Mesh> = {};
  private readonly joints: { i: number; mesh: Mesh; r: number }[] = [];
  private head: Mesh;
  private neck: Mesh;

  constructor(readonly exercise: ExerciseId) {
    const A = sharedAssets();
    const muscles = new Set(MUSCLES[exercise]);
    this.scene.add(this.body);

    // Свет: мягкий верхний, основной спереди-сверху, холодный заполняющий и оранжевый контровой (бренд).
    this.scene.add(new HemisphereLight('#ffffff', '#1e293b', 1.15));
    const key = new DirectionalLight('#ffffff', 2.6);
    key.position.set(1.6, 3.2, 3.4);
    this.scene.add(key);
    const fill = new DirectionalLight('#9cc8ff', 0.5);
    fill.position.set(-2.4, 1.2, 2);
    this.scene.add(fill);
    const rim = new DirectionalLight('#fb923c', 2.2);
    rim.position.set(-1.8, 2.4, -2.8);
    this.scene.add(rim);

    const shadow = new Mesh(
      A.geo.disc!,
      new MeshBasicMaterial({ map: A.shadow, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(0.55, 0.32, 1);
    shadow.position.y = 0.002;
    this.scene.add(shadow);

    for (const [a, b, geo, r] of LIMBS) {
      const mesh = new Mesh(A.geo[geo]!, A.skin);
      this.body.add(mesh);
      this.segs.push({ a, b, mesh, r });
    }
    for (const o of OVERLAYS) {
      if (!muscles.has(o.muscle)) continue;
      const mat = muscleMaterial(A.fibers);
      const mesh = new Mesh(A.geo[o.geo]!, mat);
      this.body.add(mesh);
      const limb = LIMBS.find(([a, b]) => a === o.a && b === o.b)!;
      this.overlays.push({
        a: o.a,
        b: o.b,
        mesh,
        r: limb[3],
        act: o.act,
        mat,
        inner: o.muscle === 'adductors',
      });
    }

    // Суставы — сферы, чтобы сегменты сходились гладко.
    for (const [i, r] of [
      [11, 0.056],
      [12, 0.056],
      [13, 0.043],
      [14, 0.043],
      [25, 0.058],
      [26, 0.058],
      [27, 0.042],
      [28, 0.042],
    ] as [number, number][]) {
      const mesh = new Mesh(A.geo.sphere!, A.skin);
      mesh.scale.setScalar(r);
      this.body.add(mesh);
      this.joints.push({ i, mesh, r });
    }

    // Торс: грудная клетка, живот, таз. Грудные и пресс — отдельные объёмы для рельефа.
    for (const name of [
      'chest',
      'abdomen',
      'pelvis',
      'pecL',
      'pecR',
      'ab0',
      'ab1',
      'ab2',
      'ab3',
      'ab4',
      'ab5',
      'latL',
      'latR',
    ]) {
      const mesh = new Mesh(name === 'abdomen' ? A.geo.capsule! : A.geo.sphere!, A.skin);
      this.body.add(mesh);
      this.torso[name] = mesh;
    }
    this.neck = new Mesh(A.geo.capsule!, A.skin);
    this.head = new Mesh(A.geo.sphere!, A.skin);
    this.body.add(this.neck, this.head);

    // Мышцы-«шапки» на торсе: ягодичные / отводящие бедра, трапеции.
    const addBlob = (kind: string, act: string, side: number) => {
      const mat = muscleMaterial(A.fibers);
      const mesh = new Mesh(A.geo.sphere!, mat);
      this.body.add(mesh);
      this.blobs.push({ mesh, mat, act, kind, side });
    };
    if (muscles.has('glutes')) [-1, 1].forEach((s) => addBlob('glute', 'glutes', s));
    if (muscles.has('abductors')) [-1, 1].forEach((s) => addBlob('abductor', 'abductors', s));
    if (muscles.has('traps')) [-1, 1].forEach((s) => addBlob('trap', 'traps', s));
    if (muscles.has('delts')) [-1, 1].forEach((s) => addBlob('deltCap', s < 0 ? 'deltsL' : 'deltsR', s));
  }

  /** Обновить позу и нарисовать в 2D-холст назначения. */
  render(
    target: CanvasRenderingContext2D,
    W: number,
    H: number,
    pose: (V3 | null)[],
    opts: { yaw: number; mobile: boolean; highlight?: ReadonlySet<number> },
  ): boolean {
    const r = sharedRenderer(opts.mobile);
    if (!r) return false;
    this.pose(pose, opts.highlight);
    this.body.rotation.y = -opts.yaw;
    this.fit(W / H);

    return blitTo(r, this.scene, this.camera, target, W, H);
  }

  private fit(aspect: number): void {
    const b = athleteBounds();
    const cam = this.camera;
    cam.aspect = aspect;
    const vfov = (cam.fov * Math.PI) / 180;
    const needH = b.h * 1.08;
    const needW = b.w * 1.02;
    const distH = needH / 2 / Math.tan(vfov / 2);
    const distW = needW / 2 / (Math.tan(vfov / 2) * aspect);
    const dist = Math.max(distH, distW);
    cam.position.set(0, b.h * 0.5, dist);
    cam.lookAt(0, b.h * 0.47, 0);
    cam.updateProjectionMatrix();
  }

  private pose(pose: (V3 | null)[], highlight?: ReadonlySet<number>): void {
    const A = sharedAssets();
    // Данные: y вниз, лицом к зрителю −z → three: Y вверх, к камере +Z.
    const P = (i: number) => {
      const p = pose[i];
      return p ? new Vector3(p.x, -p.y, -p.z) : null;
    };
    const ls = P(11);
    const rs = P(12);
    const lh = P(23);
    const rh = P(24);
    if (!ls || !rs || !lh || !rh) return;
    const hipMid = lh.clone().add(rh).multiplyScalar(0.5);
    const shMid = ls.clone().add(rs).multiplyScalar(0.5);
    const up = shMid.clone().sub(hipMid).normalize();
    const right = rs.clone().sub(ls).normalize();
    const fwd = new Vector3().crossVectors(up, right).normalize();
    const act = activation(this.exercise, pose) as Record<string, number>;

    const place = (mesh: Mesh, a: Vector3, b: Vector3, radius: number, inner = false) => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      if (len < 1e-4) return;
      dir.divideScalar(len);
      let z = fwd.clone().sub(dir.clone().multiplyScalar(fwd.dot(dir)));
      if (z.lengthSq() < 1e-6) z = right.clone();
      z.normalize();
      let x = new Vector3().crossVectors(dir, z);
      // Приводящие — на внутренней стороне бедра: разворачиваем накладку к середине тела.
      if (inner && x.dot(hipMid.clone().sub(a)) < 0) x = x.negate();
      const m = new Matrix4().makeBasis(x, dir, inner ? new Vector3().crossVectors(x, dir) : z);
      mesh.quaternion.setFromRotationMatrix(m);
      mesh.position.copy(a);
      mesh.scale.set(radius, len, radius);
    };

    for (const s of this.segs) {
      const a = P(s.a);
      const b = P(s.b);
      if (!a || !b) continue;
      place(s.mesh, a, b, s.r);
      const hl = !!highlight && highlight.has(s.a) && highlight.has(s.b);
      s.mesh.material = hl ? A.error : A.skin;
    }
    for (const o of this.overlays) {
      const a = P(o.a);
      const b = P(o.b);
      if (!a || !b) continue;
      place(o.mesh, a, b, o.r, o.inner);
      const hl = !!highlight && highlight.has(o.a) && highlight.has(o.b);
      o.mesh.visible = !hl;
      setLoad(o.mat, act[o.act] ?? 0);
    }
    for (const j of this.joints) {
      const p = P(j.i);
      if (p) j.mesh.position.copy(p);
    }

    // Торс в базисе right / up / fwd.
    const basis = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, fwd));
    const shoulderW = ls.distanceTo(rs);
    const hipW = lh.distanceTo(rh);
    const torsoLen = shMid.distanceTo(hipMid);
    const at = (base: Vector3, u: number, f = 0, rr = 0) =>
      base
        .clone()
        .add(up.clone().multiplyScalar(u))
        .add(fwd.clone().multiplyScalar(f))
        .add(right.clone().multiplyScalar(rr));
    const put = (m: Mesh, pos: Vector3, sx: number, sy: number, sz: number) => {
      m.position.copy(pos);
      m.quaternion.copy(basis);
      m.scale.set(sx, sy, sz);
    };
    const T = this.torso;
    const torsoHl =
      !!highlight && (highlight.has(11) || highlight.has(12)) && (highlight.has(23) || highlight.has(24));
    for (const m of Object.values(T)) m.material = torsoHl ? A.error : A.skin;
    // Мужской атлетический торс: широкая грудная клетка, V-силуэт, узкий таз, плоские грудные, пресс.
    put(T.chest!, at(shMid, -torsoLen * 0.22, -0.005), shoulderW * 0.6, torsoLen * 0.34, 0.13);
    put(T.abdomen!, at(hipMid, torsoLen * 0.4), hipW * 0.78, torsoLen * 0.17, 0.105);
    put(T.pelvis!, at(hipMid, 0.035), hipW * 0.66, 0.1, 0.1);
    put(
      T.latL!,
      at(shMid, -torsoLen * 0.42, -0.02, -shoulderW * 0.3),
      shoulderW * 0.2,
      torsoLen * 0.28,
      0.08,
    );
    put(T.latR!, at(shMid, -torsoLen * 0.42, -0.02, shoulderW * 0.3), shoulderW * 0.2, torsoLen * 0.28, 0.08);
    put(
      T.pecL!,
      at(shMid, -torsoLen * 0.2, 0.085, -shoulderW * 0.22),
      shoulderW * 0.3,
      torsoLen * 0.11,
      0.045,
    );
    put(
      T.pecR!,
      at(shMid, -torsoLen * 0.2, 0.085, shoulderW * 0.22),
      shoulderW * 0.3,
      torsoLen * 0.11,
      0.045,
    );
    for (let row = 0; row < 3; row += 1) {
      for (const col of [0, 1]) {
        const m = T[`ab${row * 2 + col}`]!;
        const side = col === 0 ? -1 : 1;
        put(
          m,
          at(hipMid, torsoLen * (0.62 - row * 0.15), 0.092, side * hipW * 0.17),
          hipW * 0.15,
          torsoLen * 0.065,
          0.028,
        );
      }
    }

    // Шея и голова.
    const le = P(7);
    const re = P(8);
    const nose = P(0);
    const headC =
      le && re ? le.clone().add(re).multiplyScalar(0.5).add(up.clone().multiplyScalar(0.02)) : nose;
    if (headC) {
      const neckTop = headC.clone().sub(up.clone().multiplyScalar(0.07));
      place(this.neck, shMid, neckTop, 0.048);
      this.neck.scale.set(0.048, shMid.distanceTo(neckTop) * 0.5, 0.048);
      this.neck.position.copy(shMid.clone().add(neckTop).multiplyScalar(0.5));
      this.head.position.copy(headC);
      this.head.quaternion.copy(basis);
      this.head.scale.set(0.088, 0.112, 0.1);
    }

    // Мышцы-«шапки».
    for (const bl of this.blobs) {
      const sideR = right.clone().multiplyScalar(bl.side);
      const hip = bl.side < 0 ? lh : rh;
      const sh = bl.side < 0 ? ls : rs;
      let pos: Vector3;
      let s: [number, number, number];
      if (bl.kind === 'glute') {
        pos = hip
          .clone()
          .add(up.clone().multiplyScalar(0.04))
          .add(fwd.clone().multiplyScalar(-0.07))
          .add(sideR.multiplyScalar(-0.02));
        s = [0.085, 0.1, 0.07];
      } else if (bl.kind === 'abductor') {
        pos = hip.clone().add(up.clone().multiplyScalar(0.05)).add(sideR.multiplyScalar(0.05));
        s = [0.05, 0.085, 0.075];
      } else if (bl.kind === 'trap') {
        pos = sh
          .clone()
          .lerp(shMid, 0.45)
          .add(up.clone().multiplyScalar(0.05))
          .add(fwd.clone().multiplyScalar(-0.02));
        s = [shoulderW * 0.2, 0.05, 0.06];
      } else {
        pos = sh.clone().add(sideR.multiplyScalar(0.012)).add(up.clone().multiplyScalar(0.01));
        s = [0.062, 0.062, 0.066];
      }
      bl.mesh.position.copy(pos);
      bl.mesh.quaternion.copy(basis);
      bl.mesh.scale.set(...s);
      bl.mesh.visible = !torsoHl;
      setLoad(bl.mat, act[bl.act] ?? 0);
    }
  }
}

function muscleMaterial(fibers: CanvasTexture): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color('#e2483c'),
    map: fibers,
    roughness: 0.42,
    metalness: 0.02,
    emissive: new Color('#ff2a14'),
    emissiveIntensity: 0.2,
  });
}

/** Нагрузка 0..1 → насколько мышца «горит». Видна всегда, ярче — под нагрузкой. */
function setLoad(mat: Material, load: number): void {
  const m = mat as MeshStandardMaterial;
  m.emissiveIntensity = 0.08 + 0.55 * load;
  m.color.setRGB(0.72 + 0.2 * load, 0.2 + 0.06 * (1 - load), 0.16);
}
