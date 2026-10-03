// Бокс от первого лица: 3D-стадион (arena.ts), камера — твоя голова, перед тобой бот (анатомический атлет
// Z-Anatomy), внизу — твои руки в перчатках (glove3d.ts). Отдельный чанк с three.js, грузится только в этом виде.
//
// Каждый кадр страница (main.ts) отдаёт состояние: что делает бот (fight.ts) — из этого botPose.ts строит его
// позу (стойка, блок, замах, удар в тебя, «поплыл»), твои удары, перчатки (gloves.ts) и сдвиг корпуса
// (stance.ts). Сдвиг корпуса двигает камеру: ушёл влево — камера ушла влево и наклонилась, присел —
// опустилась. Так уклон виден в игре. Пропущенный удар отбрасывает голову (камеру) от удара, мощный ещё
// и «ведёт» её полторы секунды.
//
// Сцена в метрах: пол ринга y = 0, бот стоит в начале координат лицом к +Z, камера — на уровне его глаз в
// CAM_Z от него. Руки — дети камеры, их координаты — в пространстве камеры (вперёд — −Z).
//
// Руки — плечо и предплечье постоянной длины (двухзвенная рука, IK): кисть задаём, локоть считаем, ничего
// не растягивается. В стойке кулаки у подбородка и мягко повторяют твои кисти; удар — короткая анимация
// (punch.ts находит его начало): вылет, касание, возврат — в голову бота, снизу — в корпус, боковой — по дуге.

import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  SpotLight,
  Vector3,
  WebGLRenderer,
  BackSide,
  type Object3D,
} from 'three';
import { canvasScale } from '../engine/perf';
import { Arena } from './arena';
import { BoxerView } from './boxer3d';
import { BotPoser, type V3 } from './botPose';
import type { BotView, Side } from './fight';
import { makeArm, type ArmMeshes } from './glove3d';
import type { GloveSide, Gloves } from './gloves';

export interface FpvState {
  /** Текущее время (мс) — для анимаций. */
  now: number;
  /** Что делает бот (fight.ts). */
  bot: BotView;
  /** Твой удар попал: когда, какой рукой, в корпус ли — бот дёргается. */
  botHurt: { at: number; side: Side; low: boolean } | null;
  /** Бот принял твой удар на перчатки. */
  botBlockedAt: number;
  /** Нокдаун: 0…1 — бот падает навзничь (обратно к 0 — встаёт). */
  botKo: number;
  /** Ты на настиле: 0…1 — камера падает на канву и смотрит на бота снизу (обратно к 0 — встаёшь). */
  meDown?: number;
  /** Твоя усталость 0…1: перчатки ниже, дыхание тяжелее. */
  tired?: number;
  gloves: Gloves;
  /** Сдвиг корпуса от среднего (stance.ts), в ширинах плеч: x — вправо по кадру камеры, y — вниз. */
  shiftX: number;
  shiftY: number;
  /** Тряска камеры: 0…1 (блок). */
  shake: number;
  /** Пропущенный удар: когда, какой рукой бота, мощный ли — камеру отбрасывает. */
  knock: { at: number; side: Side; power: boolean } | null;
  /** Удары, которые сейчас идут: начало (мс, тем же часом, что now), в корпус ли, боковой ли. */
  punches: Partial<Record<GloveSide, FpvPunch>>;
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
/**
 * Урон решается чуть позже касания, пока перчатка ещё у цели: к этому моменту детектор видит, удар это
 * или мах руками (PunchDetector.confirm смотрит кадры до PUNCH.confirmMs после начала).
 */
export const PUNCH_DECIDE_MS = PUNCH_ANIM.outMs + PUNCH_ANIM.holdMs - 15;
const PUNCH_TOTAL = PUNCH_ANIM.outMs + PUNCH_ANIM.holdMs + PUNCH_ANIM.backMs;
/** Мощный пропущенный удар «ведёт» камеру столько мс. */
export const DAZE_MS = 1600;

/**
 * Бот (U-26) — человек ростом ~1,66 м: эталонная поза (~1,5 м) × BOT_SCALE. Камера — на уровне его глаз,
 * на таком расстоянии от центра ринга (м).
 */
const BOT_SCALE = 1.1;
const CAM_Y = 1.52;
const CAM_Z = 1.4;
const LOOK_Y = 1.41;
const FOV = 60;
/** Насколько камера идёт за корпусом: м на ширину плеч; наклон — рад на ширину плеч; сглаживание, мс. */
const CAM_FOLLOW_X = 0.32;
const CAM_FOLLOW_Y = 0.36;
const CAM_ROLL = 0.22;
const CAM_TAU_MS = 70;

/** Руки в пространстве камеры: плечи (чуть ниже и позади глаз), длины плеча и предплечья, м. */
const SHOULDER = { x: 0.2, y: -0.25, z: 0.05 };
const UPPER = 0.31;
const FORE = 0.3;
/** Кулак в стойке — у подбородка, перед глазами. */
const GUARD = { x: 0.15, y: -0.19, z: -0.4 };
/** Насколько стойка повторяет твои кисти: м на ширину плеч, и предел. */
const FOLLOW = 0.05;
const FOLLOW_MAX = 0.06;
const BOT_BLUE = '#1d4ed8';
const RES = { min: 0.55, slowMs: 18, fastMs: 13 };

/** Встроенная видеокарта (Intel, мобильные) — по имени рендерера WebGL. */
function integratedGpu(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = String(
      ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl?.getParameter(gl.RENDERER) ?? ''),
    );
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return /intel|iris|uhd|mali|adreno|powervr|apple gpu|swiftshader|llvmpipe/i.test(name);
  } catch {
    return true;
  }
}

export class FpvView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 16 / 9, 0.03, 120);
  private readonly bot = new BoxerView();
  private readonly botRoot = new Group();
  private readonly poser = new BotPoser();
  private readonly arena: Arena;
  private readonly botGloves: Group[];
  private readonly arms: Record<GloveSide, ArmMeshes>;
  private botGroup: Group | null = null;
  /** Голова и грудь бота в мире — цели ударов. */
  private readonly botHead = new Vector3(0, 1.38, 0);
  private readonly botChest = new Vector3(0, 1.1, 0);
  /** Сглаженный сдвиг корпуса (позы приходят ~20 раз в секунду, камера — каждый кадр). */
  private sx = 0;
  private sy = 0;
  private lastT = 0;
  /** Ты на настиле (0…1) и усталость — для рук. */
  private down = 0;
  private tired = 0;
  /**
   * Адаптивное разрешение: доля от бюджета пикселей. Кадры дольше slowMs — меньше (не ниже min), быстрее
   * fastMs несколько секунд — обратно. Так бой плавный и на слабой видеокарте (распознавание позы тоже
   * ждёт её — кадр камеры читается через неё).
   */
  private res = 1;
  private frameMs = 16;
  private resAt = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly mobile: boolean,
  ) {
    // Сглаживание (MSAA) на встроенной видеокарте съедает треть кадра (ноутбук на Iris Xe: 35 → 56 FPS без
    // него) — там его нет, а резкость держит адаптивное разрешение.
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !mobile && !integratedGpu(),
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor('#050403', 1);

    this.scene.fog = new Fog('#0c0908', 9, 42);
    this.scene.environment = this.envMap();
    this.scene.environmentIntensity = 0.55;
    this.arena = new Arena(mobile);
    this.scene.add(this.arena.group);

    // Свет: тёплый прожектор сверху на ринг, холодная заливка, оранжевый контур сзади.
    this.scene.add(new HemisphereLight('#ffffff', '#1a0f08', 0.5));
    const spot = new SpotLight('#ffe9cf', 60, 14, 0.75, 0.5, 1.4);
    spot.position.set(0, 6.2, 0.6);
    spot.target.position.set(0, 0.8, 0);
    this.scene.add(spot, spot.target);
    const key = new DirectionalLight('#ffffff', 1.25);
    key.position.set(1.2, 3, 3.2);
    const rim = new DirectionalLight('#fb923c', 2.4);
    rim.position.set(-1.6, 2.6, -2.8);
    this.scene.add(key, rim);

    // Бот: группа бойца переедет сюда, когда модель загрузится; перчатки — на его кистях. Поворот: сначала
    // падение (нокаут) в его осях, потом — лицом к тебе, где бы он ни стоял на ринге.
    this.botRoot.scale.setScalar(BOT_SCALE);
    this.botRoot.rotation.order = 'YXZ';
    this.scene.add(this.botRoot);
    this.botGloves = [-1, 1].map((d) => {
      const g = makeArm(d as -1 | 1, 0.3, 0.27, BOT_BLUE).glove;
      g.scale.setScalar(1.05);
      g.visible = false;
      return g;
    });

    // Твои руки — у камеры.
    this.scene.add(this.camera);
    const hand = new PointLight('#ffffff', 1.1, 2.4, 1.5);
    hand.position.set(0, 0.4, 0.1);
    this.camera.add(hand);
    this.arms = { left: this.makeArm(-1), right: this.makeArm(1) };
  }

  /** Толпа: 0…1 — ох на попадание, рёв на нокдаун. */
  crowd(level: number): void {
    this.arena.react(level);
  }

  /** Залп вспышек фотокамер. */
  photoBurst(ms: number): void {
    this.arena.flashBurst(ms);
  }

  /** Табло над трибунами. */
  screen(s: Parameters<Arena['setScreen']>[0]): void {
    this.arena.setScreen(s);
  }

  /** Нарисовать кадр. false — модель бота ещё грузится (сцена всё равно рисуется). */
  render(s: FpvState): boolean {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    if (!W || !H) return false;
    // Бой идёт вместе с распознаванием позы: телефону бюджет меньше, чем атлетам в меню.
    const dt = Math.min(100, Math.max(0, s.now - this.lastT));
    this.lastT = s.now;
    this.adaptRes(dt, s.now);
    const dpr = canvasScale(W, H, this.mobile, 4096, true) * this.res;
    const w = Math.round(W * dpr);
    const h = Math.round(H * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(W, H, false);
      this.camera.aspect = W / H;
      this.camera.updateProjectionMatrix();
    }
    this.arena.update(s.now);
    this.down = smooth(s.meDown ?? 0);
    this.tired = clamp01(s.tired ?? 0);
    this.placeCamera(s, dt);
    this.camera.updateMatrixWorld();
    const ready = this.poseBot(s);
    this.placeArm('left', s.gloves.left, s.punches.left, s.now);
    this.placeArm('right', s.gloves.right, s.punches.right, s.now);
    this.renderer.render(this.scene, this.camera);
    return ready;
  }

  dispose(): void {
    this.renderer.dispose();
  }

  private adaptRes(dt: number, now: number): void {
    if (dt <= 0) return;
    this.frameMs += (dt - this.frameMs) * 0.05;
    if (now - this.resAt < 1000) return;
    if (this.frameMs > RES.slowMs && this.res > RES.min) {
      this.res = Math.max(RES.min, this.res * 0.85);
      this.resAt = now;
    } else if (this.frameMs < RES.fastMs && this.res < 1 && now - this.resAt > 4000) {
      this.res = Math.min(1, this.res / 0.9);
      this.resAt = now;
    }
  }

  // ——— Бот ———

  private poseBot(s: FpvState): boolean {
    // Цель его ударов — твоя голова (камера) в координатах бота (данные: y вниз, к зрителю −z).
    this.botRoot.updateMatrixWorld();
    const cam = this.botRoot.worldToLocal(this.camera.position.clone());
    const aim: V3 = { x: cam.x, y: -cam.y, z: -cam.z };
    const { pose, step, x, lift } = this.poser.update({
      now: s.now,
      bot: s.bot,
      aim,
      hurt: s.botHurt,
      blockedAt: s.botBlockedAt,
      ko: clamp01(s.botKo),
    });
    const g = this.bot.posed(pose);
    if (!g) return false;
    if (g !== this.botGroup) {
      this.botGroup = g;
      g.rotation.set(0, 0, 0);
      this.botRoot.add(g);
      for (const m of this.botGloves) g.add(m);
    }
    // Перчатки бота — на запястье, костяшками по направлению кулака.
    [
      [15, 19],
      [16, 20],
    ].forEach(([wi, fi], k) => {
      const wp = pose[wi!];
      const fp = pose[fi!];
      const m = this.botGloves[k]!;
      m.visible = !!wp && !!fp;
      if (!wp || !fp) return;
      const W = new Vector3(wp.x, -wp.y, -wp.z);
      const dir = new Vector3(fp.x, -fp.y, -fp.z).sub(W).normalize();
      m.position.copy(W);
      // −Z перчатки — по кулаку, верх — как можно ближе к «вверх».
      m.quaternion.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), dir, new Vector3(0, 1, 0)));
    });
    // Шаг — к камере, ходит по рингу и пружинит, всегда лицом к тебе; нокаут — падает навзничь (вокруг стоп).
    const ko = clamp01(s.botKo);
    const koEase = ko * ko;
    const z = step - 0.35 * koEase;
    this.botRoot.position.set(x, lift * (1 - ko), z);
    const yaw = Math.atan2(this.camera.position.x - x, this.camera.position.z - z);
    this.botRoot.rotation.set(-1.35 * koEase, yaw, 0.25 * koEase);
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

  private placeCamera(s: FpvState, dt: number): void {
    // Сдвиг корпуса — плавно, каждый кадр (позы приходят реже кадров).
    const k = 1 - Math.exp(-dt / CAM_TAU_MS);
    this.sx += (clamp(s.shiftX, -1.4, 1.4) - this.sx) * k;
    this.sy += (clamp(s.shiftY, -0.6, 1.4) - this.sy) * k;
    const sx = this.sx;
    const sy = this.sy;
    const t = s.now;
    const shake = clamp01(s.shake);
    let jx = shake * 0.02 * Math.sin(t / 17);
    let jy = shake * 0.015 * Math.cos(t / 13);
    // Твой удар: чуть вперёд, в удар.
    let lunge = 0;
    for (const p of Object.values(s.punches)) {
      if (!p) continue;
      const u = (t - p.start) / PUNCH_TOTAL;
      if (u >= 0 && u < 1) lunge = Math.max(lunge, Math.sin(Math.PI * u));
    }
    // Пропущенный удар: голову отбрасывает от удара, затухающими качаниями; мощный ещё и «ведёт».
    let yaw = 0;
    let pitch = 0;
    let roll = 0;
    let fov = FOV;
    if (s.knock) {
      const kt = t - s.knock.at;
      if (kt >= 0 && kt < 900) {
        const amp = s.knock.power ? 1 : 0.45;
        const d = Math.exp(-kt / 170) * Math.cos(kt / 75) * Math.min(1, kt / 18);
        // Левой рукой бот бьёт с твоей правой стороны экрана — голова уходит влево.
        const from = s.knock.side === 'left' ? 1 : -1;
        yaw += from * 0.16 * amp * d;
        pitch += 0.13 * amp * d;
        roll += from * 0.1 * amp * d;
        jx += -from * 0.05 * amp * d;
        jy += 0.03 * amp * d;
      }
      if (s.knock.power && kt >= 0 && kt < DAZE_MS) {
        const left = 1 - kt / DAZE_MS;
        roll += 0.07 * left * Math.sin(kt / 210);
        yaw += 0.04 * left * Math.sin(kt / 330);
        pitch += 0.03 * left * Math.sin(kt / 260);
        fov += 6 * left * left;
      }
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    let x = -sx * CAM_FOLLOW_X + jx;
    let y = CAM_Y - Math.max(0, sy) * CAM_FOLLOW_Y - Math.min(0, sy) * 0.08 + jy;
    // Покачивание головы в стойке — живая камера; устал — дышит тяжело, глубже и реже.
    const breathe = 0.006 * Math.sin(t / 420) + this.tired * 0.014 * Math.sin(t / 330);
    let z = CAM_Z - 0.05 * lunge;
    let lookY = LOOK_Y - Math.max(0, sy) * 0.12 + this.tired * 0.02 * Math.sin(t / 330);
    // Нокдаун: падаешь на канву, мир заваливается набок, бот стоит над тобой — смотришь снизу вверх.
    const dn = this.down;
    if (dn > 0) {
      const sway = Math.sin(t / 520) * 0.04 * dn;
      x = x * (1 - dn) + 0.15 * dn + sway;
      y = y * (1 - dn) + 0.3 * dn;
      z = z * (1 - dn) + (CAM_Z + 0.35) * dn;
      lookY = lookY * (1 - dn) + 1.2 * dn;
      roll += 0.42 * dn + 0.05 * dn * Math.sin(t / 700);
      pitch += 0.04 * dn * Math.sin(t / 610);
    }
    this.camera.position.set(x, y + breathe * (1 - dn), z);
    this.camera.lookAt(x * 0.35, lookY, 0);
    this.camera.rotateY(yaw);
    this.camera.rotateX(pitch);
    this.camera.rotateZ(sx * CAM_ROLL * (1 - dn) + roll + shake * 0.03 * Math.sin(t / 23));
  }

  // ——— Твои руки ———

  private makeArm(dir: -1 | 1): ArmMeshes {
    const a = makeArm(dir, UPPER, FORE);
    this.camera.add(a.glove, a.upper, a.fore, a.elbow);
    return a;
  }

  private placeArm(side: GloveSide, g: Gloves[GloveSide], punch: FpvPunch | undefined, now: number): void {
    const dir = side === 'left' ? -1 : 1;
    const { glove, upper, fore, elbow: elbowMesh } = this.arms[side];
    const shoulder = new Vector3(dir * SHOULDER.x, SHOULDER.y, SHOULDER.z);
    // Стойка: кулак у подбородка, чуть повторяет кисть (вбок, вверх-вниз, вперёд) и дышит.
    const ext = clamp01(g.ext);
    const fx = clamp((g.x - dir * 0.45) * FOLLOW, -FOLLOW_MAX, FOLLOW_MAX);
    const fy = clamp(-(g.y + 0.35) * FOLLOW, -FOLLOW_MAX, FOLLOW_MAX);
    const bob = 0.006 * Math.sin(now / 260 + dir);
    // Устал — перчатки тяжелеют и опускаются; на настиле — руки вниз, из кадра.
    const sag = 0.06 * this.tired + 0.42 * this.down;
    const guard = new Vector3(
      dir * (GUARD.x + 0.05 * this.down) + fx,
      GUARD.y + fy + bob - sag,
      GUARD.z - 0.08 * ext + 0.1 * this.down,
    );
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
        // Кулак — на луче от глаза к цели (голова или корпус бота), на расстоянии вытянутой руки от плеча:
        // на экране он ложится ровно на соперника, а рука остаётся своей длины.
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
    elbowMesh.position.copy(elbow);
    // Перчатка — на кисти, костяшками туда, куда бьёт; в прямом — доворот кулака ладонью вниз.
    glove.position.copy(reached);
    glove.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), aimDir);
    glove.rotateZ(-dir * (0.35 + (punch?.hook ? 0.5 : 1.1) * k));
  }

  /** Карта отражений: тёмный зал и яркие лампы над рингом — блики на перчатках и коже. */
  private envMap() {
    const env = new Scene();
    env.add(
      new Mesh(new SphereGeometry(10, 24, 12), new MeshBasicMaterial({ color: '#0b0807', side: BackSide })),
    );
    const lamp = (x: number, y: number, z: number, s: number, c: Color) => {
      const m = new Mesh(new PlaneGeometry(s, s), new MeshBasicMaterial({ color: c, side: BackSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    const warm = new Color(6, 5.4, 4.6);
    for (const [x, z] of [
      [-2, -2],
      [2, -2],
      [-2, 2],
      [2, 2],
      [0, 0],
    ] as const)
      lamp(x, 6, z, 2.2, warm);
    lamp(-8, 2, -5, 3, new Color(1.6, 0.7, 0.25));
    lamp(8, 2.5, -4, 3, new Color(0.5, 0.8, 1.6));
    const pm = new PMREMGenerator(this.renderer);
    const tex = pm.fromScene(env, 0.02).texture;
    pm.dispose();
    return tex;
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

/** Меш с осью Y и длиной своей геометрии — поставить от a к b (без растяжения). */
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
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
