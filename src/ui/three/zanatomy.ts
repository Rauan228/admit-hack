// Анатомический атлет на модели Z-Anatomy (CC BY-SA 4.0, на основе BodyParts3D, CC BY-SA 2.1 JP).
// Модель подготовлена scripts/blender/prep-zanatomy.py: мышцы и видимые кости упрощены, подсвечиваемые
// мышечные группы — отдельные меши по сторонам (quads_l, glutes_r, ...), суставы — в zanatomyJoints.json.
//
// Скелета в модели нет — строим его сами: веса вершин считаем при загрузке по расстоянию до сегментов
// костей (голень, бедро, плечо...), а каждый кадр ставим кости по 3D-точкам движения (lib/athlete.ts):
// поворот + растяжение сегмента под длину (у человека из записи другие пропорции, чем у модели).

import {
  Bone,
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
  CylinderGeometry,
  CanvasTexture,
  DoubleSide,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MUSCLES, activation, athleteBounds, type GhostId, type Muscle } from '../lib/athlete';
import { sharedRenderer, blitTo } from './renderer';
import { BONES, REST, jv, mid, type BoneDef } from './skin';
import { skinParts } from './skinLoad';

type V3 = { x: number; y: number; z: number };

import { wantsLiteModel } from '../../engine/perf';

/** Слабому устройству — облегчённая модель (~3× меньше треугольников), остальным — полная. */
const MODEL_URL = `${import.meta.env.BASE_URL}models/${wantsLiteModel() ? 'athlete-lite' : 'athlete'}.glb`;

// ——— Загрузка модели (один раз) ———

interface Model {
  parts: { name: string; geo: BufferGeometry }[];
}
let modelPromise: Promise<Model> | null = null;

export function loadModel(): Promise<Model> {
  modelPromise ??= new GLTFLoader().loadAsync(MODEL_URL).then(async (gltf) => {
    const parts: Model['parts'] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const geo = m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);
      geo.deleteAttribute('uv');
      parts.push({ name: m.name, geo });
    });
    await skinParts(parts, MODEL_URL);
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
/** Кисть ниже — опирается на пол (м над полом). */
const FLOOR_HAND = 0.1;
/** Какую долю скручивания берёт сегмент: плечо — частично (ротация в плечевом суставе), предплечье и кисть — всё. */
const TWIST_SHARE: Record<string, number> = { arm: 0.35, forearm: 1, hand: 1 };

/** Опора кистью на пол: куда смотрят пальцы (кисть → указательный) и лежит ли на полу предплечье (планка). */
interface HandSupport {
  fingers: Vector3;
  forearm: boolean;
}

/**
 * Поворот вокруг оси сегмента, после которого ладонь смотрит туда, куда смотрит у человека:
 * рука горизонтально (вперёд или в сторону) — вниз; рука вертикально (вдоль тела, на поясе, над головой) —
 * к середине тела. Кисть на полу (отжимания, упор): ладонь плоско вниз, пальцы вперёд — предплечье смотрит
 * ладонной стороной туда же, куда пальцы; на предплечьях (планка) — кулаки ладонями друг к другу.
 */
function palmTwist(b: BoneDef, R: Matrix4, dir: Vector3, support: HandSupport | null): Matrix4 {
  const part = b.name.split('.')[0]!;
  const share = TWIST_SHARE[part] ?? 0;
  if (!share) return new Matrix4();
  const side = b.name.endsWith('.l') ? 1 : -1;
  const palm = new Vector3(0, 0, 1).applyMatrix4(new Matrix4().extractRotation(R)); // в покое — вперёд
  const horiz = Math.sqrt(Math.max(0, 1 - dir.y * dir.y)); // 1 — рука горизонтально
  const inward = new Vector3(-side, 0, 0); // к середине тела (модель: левая сторона — +x)
  let want = DOWN.clone()
    .multiplyScalar(horiz)
    .add(inward.clone().multiplyScalar(1 - horiz));
  if (support && part !== 'arm')
    want = support.forearm ? inward : part === 'hand' ? DOWN.clone() : support.fingers.clone();
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
  /** Перекладина турника (подтягивания): ставим каждый кадр по пальцам атлета. */
  private readonly barMesh: Mesh | null;

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
    this.barMesh =
      exercise === 'pull_up'
        ? new Mesh(
            new CylinderGeometry(0.017, 0.017, 1.3, 20),
            new MeshStandardMaterial({ color: '#9ca3af', metalness: 0.85, roughness: 0.3 }),
          )
        : null;
    if (this.barMesh) {
      this.barMesh.rotation.z = Math.PI / 2;
      this.group.add(this.barMesh);
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

  /**
   * Для своей сцены (бокс от первого лица, fight/fpv.ts): поставить позу и отдать группу атлета — её можно
   * перенести в другую сцену. null — модель ещё грузится.
   */
  posed(pose: (V3 | null)[], highlight?: ReadonlySet<number>): Group | null {
    if (!this.ready || !this.pose(pose, highlight)) return null;
    return this.group;
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
  /** Кисть этой руки на полу (упор): тогда ладонь кладём плоско — см. palmTwist. */
  private support(name: string, P: (i: number) => Vector3 | null): HandSupport | null {
    const left = name.endsWith('.l');
    const W = P(left ? 15 : 16);
    const F = P(left ? 19 : 20);
    const E = P(left ? 13 : 14);
    if (!W || !F || !E || W.y > FLOOR_HAND) return null;
    return { fingers: F.clone().sub(W).setY(0).normalize(), forearm: E.y < FLOOR_HAND };
  }

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
    // Перекладина — через обхват кистей: чуть выше запястий, между пальцами.
    if (this.barMesh) {
      const lf = P(19) ?? P(15);
      const rf = P(20) ?? P(16);
      const lw = P(15);
      const rw = P(16);
      if (lf && rf && lw && rw) {
        const c = mid(mid(lf, rf), mid(lw, rw));
        this.barMesh.position.set(c.x, c.y + 0.015, c.z);
      }
    }
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
          if (i >= 9) R.premultiply(palmTwist(b, R, d.clone().normalize(), this.support(b.name, P)));
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
