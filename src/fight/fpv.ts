// Бокс от первого лица: 3D-ринг, где камера — твоя голова, перед тобой бот (анатомический атлет Z-Anatomy
// с эталоном бокса), внизу — твои перчатки. Отдельный чанк с three.js, грузится только в этом виде.
//
// Каждый кадр страница (main.ts) отдаёт состояние: время в эталоне бокса для позы бота, его выпад и отдачу
// от твоего удара, перчатки (gloves.ts) и сдвиг корпуса (stance.ts). Сдвиг корпуса двигает камеру: ушёл
// влево — камера ушла влево и наклонилась, присел — опустилась. Так уклон виден в игре.
//
// Сцена в метрах: пол y = 0, бот стоит в начале координат лицом к +Z, камера — на уровне его глаз в
// CAM_Z от него. Перчатки — дети камеры, их координаты — в пространстве камеры (вперёд — −Z).
//
// Руки — плечо и предплечье постоянной длины (двухзвенная рука, IK): кисть задаём, локоть считаем, ничего
// не растягивается. В стойке кулаки у подбородка и мягко повторяют твои кисти (gloves.ts); удар — короткая
// анимация (punch.ts находит его начало): вылет, касание, возврат — в голову бота, снизу — в корпус,
// боковой — по дуге снаружи. На экране кулак ложится на соперника, как в играх, хотя рука короче дистанции.

import {
  ACESFilmicToneMapping,
  BackSide,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  SpotLight,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { canvasScale } from '../engine/perf';
import { athletePose } from '../ui/lib/athlete';
import { ZAthleteView } from '../ui/three/zanatomy';
import type { GloveSide, Gloves } from './gloves';

export interface FpvState {
  /** Момент в эталоне бокса (мс) — поза бота. */
  botT: number;
  /** Выпад бота к тебе: −0,2 откинулся на замахе, 1 — шаг в удар. */
  botLunge: number;
  /** Отдача от твоего удара: 0…1. */
  botRecoil: number;
  /** Нокаут: 0…1 — бот падает навзничь. */
  botKo: number;
  gloves: Gloves;
  /** Сдвиг корпуса от среднего (stance.ts), в ширинах плеч: x — вправо по кадру камеры, y — вниз. */
  shiftX: number;
  shiftY: number;
  /** Тряска камеры: 0…1 (пропустил удар, блок). */
  shake: number;
  /** Удары, которые сейчас идут: начало (мс, тем же часом, что now), в корпус ли, боковой ли. */
  punches: Partial<Record<GloveSide, FpvPunch>>;
  /** Текущее время (мс) — для анимации ударов. */
  now: number;
}

export interface FpvPunch {
  start: number;
  low: boolean;
  hook: boolean;
}

/** Анимация удара: вылет до касания, задержка на касании, возврат в стойку (мс). */
export const PUNCH_ANIM = { outMs: 110, holdMs: 50, backMs: 180 } as const;
/** Касание — через столько мс после начала удара: тогда урон, отдача бота, звук. */
export const PUNCH_CONTACT_MS = PUNCH_ANIM.outMs;
const PUNCH_TOTAL = PUNCH_ANIM.outMs + PUNCH_ANIM.holdMs + PUNCH_ANIM.backMs;

/** Камера — на уровне глаз бота, на таком расстоянии от него (м). */
const CAM_Y = 1.42;
const CAM_Z = 1.4;
const LOOK_Y = 1.3;
/** Шаг бота в удар, м: его кулак доходит почти до камеры. */
const BOT_STEP = 0.5;
/** Насколько камера идёт за корпусом: м на ширину плеч; наклон — рад на ширину плеч. */
const CAM_FOLLOW_X = 0.32;
const CAM_FOLLOW_Y = 0.36;
const CAM_ROLL = 0.22;
const RING = { x0: -2.4, x1: 2.4, z0: -2.6, z1: 2.2, ropes: [0.48, 0.84, 1.2] };

/** Руки в пространстве камеры: плечи (чуть ниже и позади глаз), длины плеча и предплечья, м. */
const SHOULDER = { x: 0.2, y: -0.25, z: 0.05 };
const UPPER = 0.31;
const FORE = 0.3;
/** Кулак в стойке — у подбородка, перед глазами. */
const GUARD = { x: 0.16, y: -0.2, z: -0.4 };
/** Насколько стойка повторяет твои кисти: м на ширину плеч, и предел. */
const FOLLOW = 0.05;
const FOLLOW_MAX = 0.06;
const GLOVE_RED = '#d61f26';
const BOT_BLUE = '#1d4ed8';

export class FpvView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(58, 16 / 9, 0.03, 80);
  private readonly bot = new ZAthleteView('boxing');
  private readonly botRoot = new Group();
  private readonly botGloves: Mesh[];
  private readonly gloves: Record<GloveSide, { glove: Group; upper: Mesh; fore: Mesh }>;
  private botGroup: Group | null = null;
  /** Голова и грудь бота в мире — цели ударов. */
  private readonly botHead = new Vector3(0, 1.38, 0);
  private readonly botChest = new Vector3(0, 1.1, 0);

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly mobile: boolean,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor('#070504', 1);

    this.scene.fog = new Fog('#070504', 6, 22);
    this.buildArena();

    // Свет: тёплый прожектор сверху на бота, холодная заливка, оранжевый контур сзади (как у атлета платформы).
    this.scene.add(new HemisphereLight('#ffffff', '#1a0f08', 0.55));
    const spot = new SpotLight('#ffe4c4', 38, 12, 0.62, 0.55, 1.6);
    spot.position.set(0, 5.2, 0.9);
    spot.target.position.set(0, 1, 0);
    this.scene.add(spot, spot.target);
    const key = new DirectionalLight('#ffffff', 1.3);
    key.position.set(1.2, 2.6, 3.2);
    const fill = new DirectionalLight('#9cc8ff', 0.45);
    fill.position.set(-2.4, 1.4, 2);
    const rim = new DirectionalLight('#fb923c', 2.6);
    rim.position.set(-1.6, 2.6, -2.8);
    this.scene.add(key, fill, rim);

    // Бот: группа атлета переедет сюда, когда модель загрузится; перчатки — на его кистях.
    this.scene.add(this.botRoot);
    const botGloveMat = new MeshStandardMaterial({ color: BOT_BLUE, roughness: 0.35, metalness: 0.05 });
    this.botGloves = [0, 1].map(() => {
      const m = new Mesh(new SphereGeometry(1, 20, 14), botGloveMat);
      m.scale.set(0.062, 0.058, 0.07);
      m.visible = false;
      return m;
    });

    // Твои перчатки — у камеры.
    this.scene.add(this.camera);
    const hand = new PointLight('#ffffff', 0.9, 2.2, 1.5);
    hand.position.set(0, 0.35, 0.1);
    this.camera.add(hand);
    this.gloves = { left: this.makeGlove(-1), right: this.makeGlove(1) };
  }

  /** Нарисовать кадр. false — модель бота ещё грузится (сцена всё равно рисуется). */
  render(s: FpvState): boolean {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    if (!W || !H) return false;
    // Бой идёт вместе с распознаванием позы: телефону бюджет меньше, чем атлетам в меню.
    const dpr = canvasScale(W, H, this.mobile, 4096, true);
    const w = Math.round(W * dpr);
    const h = Math.round(H * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(W, H, false);
      this.camera.aspect = W / H;
      this.camera.updateProjectionMatrix();
    }
    const ready = this.poseBot(s);
    this.placeCamera(s);
    this.camera.updateMatrixWorld();
    this.placeGlove('left', s.gloves.left, s.punches.left, s.now);
    this.placeGlove('right', s.gloves.right, s.punches.right, s.now);
    this.renderer.render(this.scene, this.camera);
    return ready;
  }

  dispose(): void {
    this.renderer.dispose();
  }

  // ——— Бот ———

  private poseBot(s: FpvState): boolean {
    const pose = athletePose('boxing', s.botT);
    const g = this.bot.posed(pose);
    if (!g) return false;
    if (g !== this.botGroup) {
      this.botGroup = g;
      g.rotation.set(0, 0, 0);
      this.botRoot.add(g);
      for (const m of this.botGloves) g.add(m);
    }
    // Перчатки бота — между запястьем и пальцами (данные: y вниз, к зрителю −z → three: Y вверх, к камере +Z).
    [
      [15, 19],
      [16, 20],
    ].forEach(([wi, fi], k) => {
      const wp = pose[wi!];
      const fp = pose[fi!] ?? wp;
      const m = this.botGloves[k]!;
      m.visible = !!wp && !!fp;
      if (wp && fp) m.position.set((wp.x + fp.x) / 2, -(wp.y + fp.y) / 2, -(wp.z + fp.z) / 2 + 0.01);
    });
    // Выпад — шаг к камере, отдача — назад и наклон, нокаут — падает навзничь (вокруг стоп).
    const ko = clamp01(s.botKo);
    const koEase = ko * ko;
    this.botRoot.position.set(0, 0, BOT_STEP * s.botLunge - 0.12 * s.botRecoil - 0.35 * koEase);
    this.botRoot.rotation.set(-0.14 * s.botRecoil - 1.35 * koEase + 0.05 * s.botLunge, 0, 0.25 * koEase);
    // Цели ударов — нос и середина груди бота в мире.
    this.botRoot.updateMatrixWorld();
    const nose = pose[0];
    const ls = pose[11];
    const rs = pose[12];
    if (nose) this.botHead.set(nose.x, -nose.y, -nose.z).applyMatrix4(this.botRoot.matrixWorld);
    if (ls && rs)
      this.botChest
        .set((ls.x + rs.x) / 2, -(ls.y + rs.y) / 2 - 0.16, -(ls.z + rs.z) / 2)
        .applyMatrix4(this.botRoot.matrixWorld);
    return true;
  }

  // ——— Камера ———

  private placeCamera(s: FpvState): void {
    // Тело влево (по кадру камеры вправо, shiftX > 0) — камера влево и наклон влево.
    const sx = clamp(s.shiftX, -1.4, 1.4);
    const sy = clamp(s.shiftY, -0.6, 1.4);
    const shake = clamp01(s.shake);
    const t = performance.now();
    const jx = shake * 0.035 * Math.sin(t / 17);
    const jy = shake * 0.025 * Math.cos(t / 13);
    const x = -sx * CAM_FOLLOW_X + jx;
    const y = CAM_Y - Math.max(0, sy) * CAM_FOLLOW_Y - Math.min(0, sy) * 0.08 + jy;
    this.camera.position.set(x, y, CAM_Z);
    this.camera.lookAt(x * 0.35, LOOK_Y - Math.max(0, sy) * 0.12, 0);
    this.camera.rotateZ(sx * CAM_ROLL + shake * 0.05 * Math.sin(t / 23));
  }

  // ——— Перчатки ———

  private makeGlove(dir: -1 | 1): { glove: Group; upper: Mesh; fore: Mesh } {
    const red = new MeshStandardMaterial({
      color: GLOVE_RED,
      roughness: 0.3,
      metalness: 0.05,
      emissive: '#3a0606',
    });
    const white = new MeshStandardMaterial({ color: '#f4f4f5', roughness: 0.5 });
    const sleeve = new MeshStandardMaterial({ color: '#1c1c20', roughness: 0.8 });
    // Перчатка: начало координат — запястье, кулак — вперёд по −Z.
    const glove = new Group();
    const fist = new Mesh(new SphereGeometry(1, 28, 20), red);
    fist.scale.set(0.05, 0.048, 0.064);
    fist.position.z = -0.075;
    const thumb = new Mesh(new SphereGeometry(1, 16, 12), red);
    thumb.scale.set(0.022, 0.024, 0.042);
    thumb.position.set(-dir * 0.047, -0.012, -0.085);
    const cuff = new Mesh(new CylinderGeometry(0.044, 0.048, 0.07, 24), red);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = -0.005;
    const band = new Mesh(new CylinderGeometry(0.0455, 0.0455, 0.02, 24), white);
    band.rotation.x = Math.PI / 2;
    band.position.z = -0.002;
    glove.add(fist, thumb, cuff, band);
    // Плечо и предплечье — цилиндры постоянной длины (ставим каждый кадр).
    const upper = new Mesh(new CylinderGeometry(0.042, 0.05, UPPER, 16), sleeve);
    const fore = new Mesh(new CylinderGeometry(0.036, 0.043, FORE, 16), sleeve);
    this.camera.add(glove, upper, fore);
    return { glove, upper, fore };
  }

  private placeGlove(side: GloveSide, g: Gloves[GloveSide], punch: FpvPunch | undefined, now: number): void {
    const dir = side === 'left' ? -1 : 1;
    const { glove, upper, fore } = this.gloves[side];
    const shoulder = new Vector3(dir * SHOULDER.x, SHOULDER.y, SHOULDER.z);
    // Стойка: кулак у подбородка, чуть повторяет кисть (вбок, вверх-вниз, вперёд).
    const ext = clamp01(g.ext);
    const fx = clamp((g.x - dir * 0.45) * FOLLOW, -FOLLOW_MAX, FOLLOW_MAX);
    const fy = clamp(-(g.y + 0.35) * FOLLOW, -FOLLOW_MAX, FOLLOW_MAX);
    const guard = new Vector3(dir * GUARD.x + fx, GUARD.y + fy, GUARD.z - 0.08 * ext);
    let wrist = guard;
    let k = 0;
    // Куда смотрят костяшки: в стойке — вперёд и чуть внутрь-вверх, в ударе — в цель.
    let aimDir = new Vector3(-dir * 0.22, 0.3, -1).normalize();
    if (punch) {
      const t = now - punch.start;
      if (t >= 0 && t < PUNCH_TOTAL) {
        const { outMs, holdMs, backMs } = PUNCH_ANIM;
        k =
          t < outMs
            ? 1 - (1 - t / outMs) ** 3
            : t < outMs + holdMs
              ? 1
              : 1 - smooth((t - outMs - holdMs) / backMs);
        // Цель — голова (или грудь) бота: рука вытягивается к ней на всю длину.
        // Кулак — на луче от глаза к цели, на расстоянии вытянутой руки от плеча: на экране он ложится ровно
        // на голову (корпус) бота, а рука остаётся своей длины.
        const aim = this.camera.worldToLocal((punch.low ? this.botChest : this.botHead).clone());
        const target = onEyeRay(aim.normalize(), shoulder, UPPER + FORE - 0.06);
        aimDir = aimDir.lerp(target.clone().normalize(), k).normalize();
        if (punch.hook) {
          // Боковой: дуга снаружи — контрольная точка сбоку от середины пути.
          const ctrl = guard
            .clone()
            .lerp(target, 0.5)
            .add(new Vector3(dir * 0.26, 0.04, 0.12));
          wrist = bezier(guard, ctrl, target, k);
        } else wrist = guard.clone().lerp(target, k);
      }
    }
    // Локоть: двухзвенная рука, сгиб — вниз и наружу.
    const elbow = solveElbow(shoulder, wrist, UPPER, FORE, new Vector3(dir * 0.7, -1, 0.15));
    // Кисть, до которой рука реально дотянулась (если цель дальше — рука прямая).
    const reached = elbow.clone().add(wrist.clone().sub(elbow).setLength(FORE));
    place(upper, shoulder, elbow);
    place(fore, elbow, reached);
    // Перчатка — на кисти, костяшками туда, куда бьёт; в прямом — доворот кулака ладонью вниз.
    glove.position.copy(reached);
    glove.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), aimDir);
    glove.rotateZ(-dir * (0.35 + (punch?.hook ? 0.5 : 1.1) * k));
  }

  // ——— Ринг ———

  private buildArena(): void {
    // Купол зала: тёмный, с размытыми огнями трибун.
    const dome = new Mesh(
      new SphereGeometry(30, 32, 16),
      new MeshBasicMaterial({ map: crowdTexture(), side: BackSide, fog: false }),
    );
    this.scene.add(dome);

    // Помост ринга.
    const w = RING.x1 - RING.x0;
    const d = RING.z1 - RING.z0;
    const canvasTex = floorTexture();
    canvasTex.wrapS = canvasTex.wrapT = RepeatWrapping;
    const floor = new Mesh(
      new PlaneGeometry(w + 0.6, d + 0.6),
      new MeshStandardMaterial({ map: canvasTex, roughness: 0.92, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((RING.x0 + RING.x1) / 2, 0, (RING.z0 + RING.z1) / 2);
    this.scene.add(floor);
    const apron = new Mesh(
      new PlaneGeometry(60, 60),
      new MeshStandardMaterial({ color: '#0a0706', roughness: 1 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.4;
    this.scene.add(apron);

    // Тень под ботом.
    const shadow = new Mesh(
      new CircleGeometry(1, 32),
      new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(0.6, 0.4, 1);
    shadow.position.y = 0.003;
    this.botRoot.add(shadow);

    // Стойки по углам и канаты.
    const postMat = new MeshStandardMaterial({ color: '#27272a', roughness: 0.5, metalness: 0.4 });
    const padMat = new MeshStandardMaterial({ color: '#f97316', roughness: 0.55, emissive: '#3b1405' });
    const corners: [number, number][] = [
      [RING.x0, RING.z0],
      [RING.x1, RING.z0],
      [RING.x1, RING.z1],
      [RING.x0, RING.z1],
    ];
    for (const [cx, cz] of corners) {
      const post = new Mesh(new CylinderGeometry(0.05, 0.05, 1.42, 12), postMat);
      post.position.set(cx, 0.71, cz);
      const pad = new Mesh(new CylinderGeometry(0.085, 0.085, 0.86, 16), padMat);
      pad.position.set(cx, 0.84, cz);
      this.scene.add(post, pad);
    }
    const ropeMats = ['#e4e4e7', '#f97316', '#e4e4e7'].map(
      (c) => new MeshStandardMaterial({ color: c, roughness: 0.4, emissive: c, emissiveIntensity: 0.08 }),
    );
    RING.ropes.forEach((h, i) => {
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k]!;
        const [bx, bz] = corners[(k + 1) % 4]!;
        const rope = new Mesh(new CylinderGeometry(0.016, 0.016, 1, 10), ropeMats[i]!);
        stretch(rope, new Vector3(ax, h, az), new Vector3(bx, h, bz));
        this.scene.add(rope);
      }
    });
  }
}

/** Локоть двухзвенной руки: плечо s, кисть w, длины a и b, сгиб в сторону pole. Цель дальше — рука прямая. */
function solveElbow(s: Vector3, w: Vector3, a: number, b: number, pole: Vector3): Vector3 {
  const d = w.clone().sub(s);
  const len = Math.min(Math.max(d.length(), 1e-4), a + b - 1e-4);
  const u = d.normalize();
  const cos = clamp((a * a + len * len - b * b) / (2 * a * len), -1, 1);
  const sin = Math.sqrt(1 - cos * cos);
  const n = pole
    .clone()
    .sub(u.clone().multiplyScalar(pole.dot(u)))
    .normalize();
  return s
    .clone()
    .add(u.multiplyScalar(a * cos))
    .add(n.multiplyScalar(a * sin));
}

/** Точка на луче из глаза (начало координат камеры) по направлению h на расстоянии reach от плеча s. */
function onEyeRay(h: Vector3, s: Vector3, reach: number): Vector3 {
  const hs = h.dot(s);
  const disc = hs * hs - s.lengthSq() + reach * reach;
  const t = disc > 0 ? hs + Math.sqrt(disc) : Math.max(0.2, hs);
  return h.clone().multiplyScalar(t);
}

/** Цилиндр по оси Y с длиной своей геометрии — поставить от a к b (без растяжения). */
function place(m: Object3D, a: Vector3, b: Vector3): void {
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize()));
}

function bezier(a: Vector3, c: Vector3, b: Vector3, t: number): Vector3 {
  const u = 1 - t;
  return a
    .clone()
    .multiplyScalar(u * u)
    .add(c.clone().multiplyScalar(2 * u * t))
    .add(b.clone().multiplyScalar(t * t));
}

const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Цилиндр высотой 1 по оси Y — растянуть между двумя точками. */
function stretch(m: Object3D, a: Vector3, b: Vector3): void {
  const d = b.clone().sub(a);
  const len = d.length();
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()));
  m.scale.set(1, len, 1);
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Пол ринга: тёмный брезент, круг и FORMA в центре. */
function floorTexture(): CanvasTexture {
  const [c, g] = canvas2d(1024, 1024);
  const bg = g.createRadialGradient(512, 512, 40, 512, 512, 720);
  bg.addColorStop(0, '#2b211b');
  bg.addColorStop(1, '#120d0a');
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 1024);
  // Фактура брезента.
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
  }
  g.strokeStyle = 'rgba(249,115,22,0.55)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(512, 512, 200, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 14;
  g.strokeRect(24, 24, 976, 976);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.font = '900 120px Onest, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('FORMA', 512, 512);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Зал: тёмный купол, внизу полоса размытых тёплых огней — трибуны. */
function crowdTexture(): CanvasTexture {
  const [c, g] = canvas2d(2048, 1024);
  const bg = g.createLinearGradient(0, 0, 0, 1024);
  bg.addColorStop(0, '#030202');
  bg.addColorStop(0.45, '#0d0806');
  bg.addColorStop(0.55, '#1a0f09');
  bg.addColorStop(1, '#050303');
  g.fillStyle = bg;
  g.fillRect(0, 0, 2048, 1024);
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * 2048;
    const y = 470 + (Math.random() - 0.3) * 110;
    const r = 2 + Math.random() * 7;
    const warm = Math.random() < 0.75;
    const a = 0.05 + Math.random() * 0.25;
    const glow = g.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, warm ? `rgba(255,170,90,${a})` : `rgba(160,200,255,${a})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function shadowTexture(): CanvasTexture {
  const [c, g] = canvas2d(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(0,0,0,0.6)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
