// Боец в меню боя (U-26): тот же 3D-боксёр, что на ринге (boxer3d.ts), в своей маленькой сцене — пружинит в
// стойке, время от времени бьёт джеб и двойку в пустоту. Позы — от того же BotPoser, что в бою.
// Раньше здесь стоял анатомический атлет платформы: та модель (5,6 МБ) больше не грузится на странице боя.

import {
  ACESFilmicToneMapping,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { BoxerView } from './boxer3d';
import { BotPoser } from './botPose';
import type { BotState, BotView } from './fight';
import { makeArm } from './glove3d';

/** Что показывает боец в меню: по кругу. */
const SHOW: { state: BotState; ms: number; kind?: 'jab' | 'power'; side?: 'left' | 'right' }[] = [
  { state: 'guard', ms: 1900 },
  { state: 'windup', ms: 260, kind: 'jab', side: 'left' },
  { state: 'strike', ms: 140, kind: 'jab', side: 'left' },
  { state: 'recover', ms: 360, kind: 'jab', side: 'left' },
  { state: 'guard', ms: 1500 },
  { state: 'windup', ms: 520, kind: 'power', side: 'right' },
  { state: 'strike', ms: 200, kind: 'power', side: 'right' },
  { state: 'recover', ms: 650, kind: 'power', side: 'right' },
];
const BLUE = '#1d4ed8';

export class MenuBoxer {
  private readonly canvas = document.createElement('canvas');
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 30);
  private readonly boxer = new BoxerView();
  private readonly poser = new BotPoser();
  private readonly root = new Group();
  private readonly gloves: Group[];
  private attached = false;
  private active = true;
  private raf = 0;
  private step = 0;
  private stepAt = 0;
  private bot: BotView = { state: 'guard', since: 0, until: Infinity, attack: null };

  constructor(host: HTMLElement) {
    host.append(this.canvas);
    this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0x000000, 0);
    // Свет как на ринге: тёплый сверху-спереди, оранжевый контур сзади.
    this.scene.add(new HemisphereLight('#ffffff', '#2a160c', 1.1));
    const key = new DirectionalLight('#fff1e0', 2.4);
    key.position.set(-1.5, 3, 3);
    const rim = new DirectionalLight('#fb923c', 3.2);
    rim.position.set(2, 2.4, -2.5);
    this.scene.add(key, rim);
    this.root.rotation.y = -0.5;
    this.scene.add(this.root);
    this.gloves = [-1, 1].map((d) => {
      const g = makeArm(d as -1 | 1, 0.3, 0.27, BLUE).glove;
      g.scale.setScalar(1.05);
      return g;
    });
    this.camera.position.set(0, 1.0, 4.4);
    this.camera.lookAt(0, 0.82, 0);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Меню на экране — рисуем; ушли в бой — стоим. */
  setActive(on: boolean): void {
    this.active = on;
    if (on && !this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private readonly loop = (now: number): void => {
    this.raf = 0;
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.loop);
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    if (!W || !H || document.hidden) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(W, H, false);
      this.camera.aspect = W / H;
      this.camera.updateProjectionMatrix();
    }
    if (now >= this.stepAt) {
      const c = SHOW[this.step % SHOW.length]!;
      this.step += 1;
      this.stepAt = now + c.ms;
      this.bot = {
        state: c.state,
        since: now,
        until: now + c.ms,
        attack: c.kind ? { kind: c.kind, side: c.side ?? 'left' } : null,
        move: 'hold',
      };
    }
    const { pose, lift } = this.poser.update({
      now,
      bot: this.bot,
      aim: null,
      hurt: null,
      blockedAt: -Infinity,
      ko: 0,
    });
    const g = this.boxer.posed(pose);
    if (g && !this.attached) {
      this.attached = true;
      this.root.add(g);
      for (const m of this.gloves) g.add(m);
    }
    if (g) {
      this.root.position.y = lift;
      // Перчатки — на запястьях, костяшками по кулаку (как на ринге).
      [
        [15, 19],
        [16, 20],
      ].forEach(([wi, fi], k) => {
        const wp = pose[wi!];
        const fp = pose[fi!];
        const m = this.gloves[k]!;
        m.visible = !!wp && !!fp;
        if (!wp || !fp) return;
        const w = new Vector3(wp.x, -wp.y, -wp.z);
        const dir = new Vector3(fp.x, -fp.y, -fp.z).sub(w).normalize();
        m.position.copy(w);
        // −Z перчатки — по кулаку, верх — как можно ближе к «вверх».
        m.quaternion.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), dir, new Vector3(0, 1, 0)));
      });
    }
    this.renderer.render(this.scene, this.camera);
  };
}
