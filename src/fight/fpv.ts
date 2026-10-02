// Бокс от первого лица: 3D-ринг, где камера — твоя голова, перед тобой бот (анатомический атлет Z-Anatomy
// с эталоном бокса), внизу — твои перчатки. Отдельный чанк с three.js, грузится только в этом виде.
//
// Каждый кадр страница (main.ts) отдаёт состояние: время в эталоне бокса для позы бота, его выпад и отдачу
// от твоего удара, перчатки (gloves.ts) и сдвиг корпуса (stance.ts). Сдвиг корпуса двигает камеру: ушёл
// влево — камера ушла влево и наклонилась, присел — опустилась. Так уклон виден в игре.
//
// Сцена в метрах: пол y = 0, бот стоит в начале координат лицом к +Z, камера — на уровне его глаз в
// CAM_Z от него. Перчатки — дети камеры, их координаты — в пространстве камеры (вперёд — −Z).

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
}

/** Камера — на уровне глаз бота, на таком расстоянии от него (м). */
const CAM_Y = 1.42;
const CAM_Z = 1.75;
const LOOK_Y = 1.3;
/** Шаг бота в удар, м: его кулак доходит почти до камеры. */
const BOT_STEP = 0.75;
/** Насколько камера идёт за корпусом: м на ширину плеч; наклон — рад на ширину плеч. */
const CAM_FOLLOW_X = 0.32;
const CAM_FOLLOW_Y = 0.36;
const CAM_ROLL = 0.22;
const RING = { x0: -2.4, x1: 2.4, z0: -2.6, z1: 2.2, ropes: [0.48, 0.84, 1.2] };

/** Длина видимого предплечья, м. */
const FOREARM = 0.34;
const GLOVE_RED = '#d61f26';
const BOT_BLUE = '#1d4ed8';

export class FpvView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(58, 16 / 9, 0.03, 80);
  private readonly bot = new ZAthleteView('boxing');
  private readonly botRoot = new Group();
  private readonly botGloves: Mesh[];
  private readonly gloves: Record<GloveSide, { glove: Group; arm: Mesh }>;
  private botGroup: Group | null = null;

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
    this.placeGlove('left', s.gloves.left);
    this.placeGlove('right', s.gloves.right);
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

  private makeGlove(dir: -1 | 1): { glove: Group; arm: Mesh } {
    const red = new MeshStandardMaterial({
      color: GLOVE_RED,
      roughness: 0.3,
      metalness: 0.05,
      emissive: '#3a0606',
    });
    const white = new MeshStandardMaterial({ color: '#f4f4f5', roughness: 0.5 });
    const wrap = new MeshStandardMaterial({ color: '#18181b', roughness: 0.75 });
    const glove = new Group();
    // Кулак: сплюснутый шар, костяшки вперёд (−Z); большой палец — к середине.
    const fist = new Mesh(new SphereGeometry(1, 28, 20), red);
    fist.scale.set(0.058, 0.056, 0.074);
    const thumb = new Mesh(new SphereGeometry(1, 16, 12), red);
    thumb.scale.set(0.022, 0.024, 0.042);
    thumb.position.set(-dir * 0.046, -0.012, -0.012);
    // Манжета — белая полоса у запястья, к камере (+Z).
    const cuff = new Mesh(new CylinderGeometry(0.046, 0.05, 0.075, 24), red);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.07;
    const band = new Mesh(new CylinderGeometry(0.0475, 0.0475, 0.02, 24), white);
    band.rotation.x = Math.PI / 2;
    band.position.z = 0.072;
    glove.add(fist, thumb, cuff, band);
    // Предплечье — цилиндр от манжеты к локтю у края экрана (ставим каждый кадр).
    const arm = new Mesh(new CylinderGeometry(0.03, 0.04, 1, 16), wrap);
    this.camera.add(glove, arm);
    return { glove, arm };
  }

  private placeGlove(side: GloveSide, g: Gloves[GloveSide]): void {
    const dir = side === 'left' ? -1 : 1;
    const { glove, arm } = this.gloves[side];
    const ext = clamp01(g.ext);
    // Кисть по экрану: от середины плеч, с ограничением, чтобы перчатка не ушла за край. Удар — к центру.
    const gx = clamp(g.x, -1.2, 1.2);
    const gy = clamp(g.y, -1.2, 1.2);
    const baseX = gx * 0.2 + dir * 0.06;
    const baseY = -0.115 - (gy + 0.3) * 0.15;
    const x = baseX * (1 - 0.45 * ext);
    const y = baseY * (1 - ext) - 0.03 * ext;
    const z = -0.44 - 1.0 * ext;
    glove.position.set(x, y, z);
    // В стойке кулаки чуть смотрят внутрь, в ударе — прямо (джеб с доворотом кулака).
    glove.rotation.set(0.12 - 0.1 * ext, -dir * 0.32 * (1 - ext), -dir * (0.25 + 1.1 * ext));
    // Локоть — внизу у края экрана, в ударе уходит вперёд вслед за кулаком.
    const elbow = new Vector3(dir * 0.24, -0.44, -0.14).lerp(
      new Vector3(x + dir * 0.06, y - 0.12, z + 0.42),
      0.85 * ext,
    );
    const wrist = new Vector3(0, 0, 0.1).applyEuler(glove.rotation).add(glove.position);
    // Видна только часть предплечья у перчатки — длинная «палка» до края экрана выглядит хуже.
    const back = elbow.clone().sub(wrist);
    if (back.length() > FOREARM) elbow.copy(wrist).add(back.setLength(FOREARM));
    stretch(arm, elbow, wrist);
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
