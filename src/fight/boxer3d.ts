// 3D-боец бота в бою от первого лица: человек вместо анатомического атласа (public/models/boxer.glb, собран
// scripts/build-boxer.mjs из Microsoft Rocketbox «Sports_Male_01», MIT: мощнее фигура, шлем, атласные трусы,
// боксёрки синего угла). Вход — как у ZAthleteView: posed(pose) — 33 точки в метрах (y вниз, лицом к зрителю
// −z, x+ — левая сторона бота) → группа с моделью, позу берёт botPose.ts.
//
// Скелет Biped ставится по точкам: таз и корпус — по линиям бёдер и плеч (закрутка — поровну на два верхних
// позвонка, нижний держит ноги), голова — по ушам и носу, руки и ноги — двухзвенный IK: кисть модели ровно
// в точке запястья, где сцена рисует перчатку, стопа — в точке лодыжки. Рост подгоняется по высоте таза
// эталона, кисть уменьшена — целиком внутри перчатки.

import { Bone, Group, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

type V3 = { x: number; y: number; z: number };

const MODEL_URL = `${import.meta.env.BASE_URL}models/boxer.glb`;

const LM = {
  nose: 0,
  lEar: 7,
  rEar: 8,
  lSh: 11,
  rSh: 12,
  lEl: 13,
  rEl: 14,
  lWr: 15,
  rWr: 16,
  lIdx: 19,
  rIdx: 20,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnk: 27,
  rAnk: 28,
  lToe: 31,
  rToe: 32,
} as const;

/** Кисть внутри перчатки. */
const HAND_SCALE = 0.72;
/** «Уши» модели: на столько позади и ниже середины глаз в исходной позе, м. */
const EARS_BEHIND_EYES = new Vector3(0, -0.015, -0.09);

let modelPromise: Promise<Object3D> | null = null;

/** Модель — одна загрузка на страницу. */
function loadModel(): Promise<Object3D> {
  modelPromise ??= new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => gltf.scene);
  return modelPromise;
}

export class BoxerView {
  readonly group = new Group();
  private model: Object3D | null = null;
  /** Узлы скелета по имени (корень Bip01 без весов грузится обычным узлом, не костью). */
  private readonly b = new Map<string, Object3D>();
  private readonly rest = new Map<Object3D, { q: Quaternion; p: Vector3 }>();
  private scaled = false;
  /** Высота таза модели в исходной позе, м. */
  private hipHeight = 0;
  private readonly earsLocal = new Vector3();

  constructor() {
    // Своя копия скелета на каждого бойца (меню и ринг): один узел не может стоять в двух сценах, а позы у них
    // разные. Геометрия и текстуры — общие.
    loadModel()
      .then((scene) => this.attach(cloneSkinned(scene)))
      .catch((err: unknown) => console.error('[fight] модель бойца не загрузилась', err));
  }

  private attach(scene: Object3D): void {
    scene.traverse((o) => {
      if ((o as Bone).isBone || o.name.startsWith('Bip01')) this.b.set(o.name, o);
      // Поза меняется каждый кадр, а рамки скиннинга считаются по исходной — не отсекаем.
      if ((o as Mesh).isMesh) o.frustumCulled = false;
    });
    scene.updateMatrixWorld(true);
    for (const bone of this.b.values())
      this.rest.set(bone, { q: bone.quaternion.clone(), p: bone.position.clone() });
    this.hipHeight = this.wp('Bip01_L_Thigh').y;
    const eyes = this.wp('Bip01_LEye').add(this.wp('Bip01_REye')).multiplyScalar(0.5);
    this.earsLocal.copy(this.bone('Bip01_Head').worldToLocal(eyes.add(EARS_BEHIND_EYES)));
    for (const s of ['L', 'R']) this.bone(`Bip01_${s}_Hand`).scale.setScalar(HAND_SCALE);
    this.model = scene;
    this.group.add(scene);
  }

  /** Поставить бойца в позу; null — модель ещё грузится. */
  posed(pose: (V3 | null)[]): Group | null {
    const model = this.model;
    if (!model) return null;
    const need = [LM.lSh, LM.rSh, LM.lHip, LM.rHip, LM.lWr, LM.rWr, LM.lEl, LM.rEl];
    if (need.some((i) => !pose[i])) return this.group;
    const P = (i: number): Vector3 | null => {
      const p = pose[i];
      return p ? this.group.localToWorld(new Vector3(p.x, -p.y, -p.z)) : null;
    };
    // Рост: высота таза модели = высота таза эталона (один раз).
    if (!this.scaled) {
      const hipY = -((pose[LM.lHip]!.y + pose[LM.rHip]!.y) / 2);
      model.scale.setScalar(hipY / this.hipHeight);
      this.scaled = true;
    }
    for (const [bone, r] of this.rest) {
      bone.quaternion.copy(r.q);
      bone.position.copy(r.p);
    }
    this.group.updateMatrixWorld(true);

    const lHip = P(LM.lHip)!;
    const rHip = P(LM.rHip)!;
    const lSh = P(LM.lSh)!;
    const rSh = P(LM.rSh)!;
    const hipMid = mid(lHip, rHip);
    const shMid = mid(lSh, rSh);

    // Таз: линия бёдер и направление вверх по корпусу; середина бёдер — в точку эталона.
    const root = this.bone('Bip01');
    rotateWorld(
      root,
      frameXU(lHip.clone().sub(rHip), shMid.clone().sub(hipMid)).multiply(
        frameXU(
          this.wp('Bip01_L_Thigh').sub(this.wp('Bip01_R_Thigh')),
          this.wp('Bip01_Neck').sub(this.wp('Bip01')),
        ).invert(),
      ),
    );
    const off = hipMid.clone().sub(mid(this.wp('Bip01_L_Thigh'), this.wp('Bip01_R_Thigh')));
    root.position.copy(root.parent!.worldToLocal(root.getWorldPosition(new Vector3()).add(off)));
    root.updateMatrixWorld(true);

    // Корпус: закрутка и наклон — поровну на два верхних позвонка.
    const chest = frameXU(lSh.clone().sub(rSh), shMid.clone().sub(hipMid)).multiply(
      frameXU(
        this.wp('Bip01_L_UpperArm').sub(this.wp('Bip01_R_UpperArm')),
        this.wp('Bip01_Neck').sub(this.wp('Bip01_Spine')),
      ).invert(),
    );
    const half = new Quaternion().slerp(chest, 0.5);
    rotateWorld(this.bone('Bip01_Spine1'), half);
    rotateWorld(this.bone('Bip01_Spine2'), half);

    // Голова: уши и нос — 40 % поворота на шею, остальное на голову.
    const nose = P(LM.nose);
    const lEar = P(LM.lEar);
    const rEar = P(LM.rEar);
    if (nose && lEar && rEar) {
      const head = this.bone('Bip01_Head');
      const cur = () =>
        frameXF(
          this.wp('Bip01_LEye').sub(this.wp('Bip01_REye')),
          this.wp('Bip01_MNose').sub(head.localToWorld(this.earsLocal.clone())),
        );
      const tgt = frameXF(lEar.clone().sub(rEar), nose.clone().sub(mid(lEar, rEar)));
      rotateWorld(this.bone('Bip01_Neck'), new Quaternion().slerp(tgt.clone().multiply(cur().invert()), 0.4));
      rotateWorld(head, tgt.clone().multiply(cur().invert()));
    }

    // Руки: кисть — в запястье эталона, кулак — к костяшкам.
    for (const [S, wr, el, idx] of [
      ['L', LM.lWr, LM.lEl, LM.lIdx],
      ['R', LM.rWr, LM.rEl, LM.rIdx],
    ] as const) {
      const w = P(wr)!;
      this.limb(`Bip01_${S}_UpperArm`, `Bip01_${S}_Forearm`, `Bip01_${S}_Hand`, w, P(el)!);
      const ix = P(idx);
      if (ix) aim(this.bone(`Bip01_${S}_Hand`), this.bone(`Bip01_${S}_Finger2`), ix.sub(w));
    }
    // Ноги: стопа — в лодыжку, носок — по стопе эталона.
    for (const [S, ank, knee, toe] of [
      ['L', LM.lAnk, LM.lKnee, LM.lToe],
      ['R', LM.rAnk, LM.rKnee, LM.rToe],
    ] as const) {
      const a = P(ank);
      const k = P(knee);
      if (!a || !k) continue;
      this.limb(`Bip01_${S}_Thigh`, `Bip01_${S}_Calf`, `Bip01_${S}_Foot`, a, k);
      const t = P(toe);
      if (t) aim(this.bone(`Bip01_${S}_Foot`), this.bone(`Bip01_${S}_Toe0`), t.sub(a));
    }
    return this.group;
  }

  private bone(n: string): Object3D {
    const x = this.b.get(n);
    if (!x) throw new Error(`нет кости ${n}`);
    return x;
  }

  private wp(n: string): Vector3 {
    return this.bone(n).getWorldPosition(new Vector3());
  }

  /** Двухзвенная конечность: конец — ровно в target (если дотягивается), сгиб — в сторону pole. */
  private limb(upper: string, lower: string, end: string, target: Vector3, pole: Vector3): void {
    const S = this.wp(upper);
    const a = S.distanceTo(this.wp(lower));
    const b = this.wp(lower).distanceTo(this.wp(end));
    const d0 = target.clone().sub(S);
    const dir = d0.clone().normalize();
    const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, d0.length()));
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const perp = pole.clone().sub(S);
    perp.sub(dir.clone().multiplyScalar(perp.dot(dir)));
    if (perp.lengthSq() < 1e-10) perp.set(0, -1, 0);
    perp.normalize();
    const E = S.clone().addScaledVector(dir, x).addScaledVector(perp, h);
    aim(this.bone(upper), this.bone(lower), E.clone().sub(S));
    aim(this.bone(lower), this.bone(end), S.clone().addScaledVector(dir, d).sub(this.wp(lower)));
  }
}

const mid = (a: Vector3, c: Vector3) => a.clone().add(c).multiplyScalar(0.5);

/** Повернуть кость в мировых координатах (вместе с детьми). */
function rotateWorld(bone: Object3D, q: Quaternion): void {
  const parentQ = bone.parent!.getWorldQuaternion(new Quaternion());
  const wq = bone.getWorldQuaternion(new Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(q.clone().multiply(wq)));
  bone.updateMatrixWorld(true);
}

/** Направить кость (на её ребёнка) по dir. */
function aim(bone: Object3D, child: Object3D, dir: Vector3): void {
  const from = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
  const to = dir.clone().normalize();
  if (!Number.isFinite(to.x) || to.lengthSq() < 0.5) return;
  rotateWorld(bone, new Quaternion().setFromUnitVectors(from, to));
}

/** Ориентация по оси X (влево) и подсказке «вверх». */
function frameXU(x: Vector3, up: Vector3): Quaternion {
  const X = x.clone().normalize();
  const Z = new Vector3().crossVectors(X, up).normalize();
  const Y = new Vector3().crossVectors(Z, X);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
}

/** Ориентация по оси X (влево) и подсказке «вперёд». */
function frameXF(x: Vector3, fwd: Vector3): Quaternion {
  const X = x.clone().normalize();
  const Z = fwd
    .clone()
    .sub(X.clone().multiplyScalar(fwd.dot(X)))
    .normalize();
  const Y = new Vector3().crossVectors(Z, X);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
}
