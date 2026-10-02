// Стадион вокруг ринга для боя от первого лица (U-25): полные трибуны, прожекторы в дымке, вспышки
// фотокамер, табло, бегущие LED-борта. Всё — дешёвые для слабой видеокарты приёмы:
// - толпа — один InstancedMesh-подобный вызов (~3000 плоских зрителей, атлас силуэтов, свой шейдер):
//   покачиваются, на твоих ударах вскакивают и поднимают руки (uExcite), освещены лучами прожекторов;
// - вспышки — точки с шейдером: каждая сама решает, когда вспыхнуть (хэш от времени), частота — uniform;
// - лучи — открытые конусы с аддитивным градиентом; дымка — пара больших плоскостей с шумом.
// Сцена в метрах, как в fpv.ts: пол ринга y = 0, бот в начале координат, камера у +Z смотрит в −Z.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
  Vector4,
  type Object3D,
} from 'three';

/** Ринг: границы канвы и высоты канатов, м. */
export const RING = { x0: -2.4, x1: 2.4, z0: -2.6, z1: 2.2, ropes: [0.42, 0.74, 1.06, 1.38] };
/** Пол зала — ниже помоста. */
const FLOOR_Y = -1.05;
/** Центр чаши трибун (центр ринга). */
const CENTER = { x: 0, z: (RING.z0 + RING.z1) / 2 };
/** Трибуны: первый ряд, шаг рядов по радиусу и по высоте, число рядов, сектор (рад от −Z в обе стороны). */
const STANDS = { r0: 7.6, dr: 0.92, dy: 0.5, rows: 22, spread: 2.3, seat: 0.6 };
const HAZE = new Color('#0c0908');

export class Arena {
  readonly group = new Group();
  private readonly crowd: ShaderMaterial;
  private readonly flashes: ShaderMaterial;
  private readonly beams: { mesh: Mesh; base: number; speed: number; amp: number }[] = [];
  private readonly led: CanvasTexture;
  private readonly screen: { ctx: CanvasRenderingContext2D; tex: CanvasTexture; key: string };
  private excite = 0.25;
  private exciteTarget = 0.25;
  private jump = 0;
  private flashRate = 0.003;
  private burstUntil = 0;
  private lastT = 0;

  constructor(mobile: boolean) {
    const off = new Set((new URLSearchParams(location.search).get('off') ?? '').split(','));
    const add = (name: string, o: Object3D) => {
      o.name = name;
      if (!off.has(name)) this.group.add(o);
    };
    add('ring', this.buildRingPlatform());
    add('stands', buildStands());
    const seats = seatsOf(mobile ? 0.6 : 1);
    this.crowd = crowdMaterial();
    add('crowd', crowdMesh(seats, this.crowd));
    this.flashes = flashMaterial();
    add('flash', flashPoints(seats, this.flashes, mobile ? 260 : 520));
    add('lamps', roofLamps());
    if (!off.has('beams')) this.buildBeams();
    add('haze', haze());
    this.led = ledTexture();
    add('led', ledBoards(this.led));
    this.screen = jumbotron(this.group);
  }

  /**
   * Каждый кадр: время (мс). Возбуждение толпы само остывает к фону; лучи ходят по трибунам.
   */
  update(now: number): void {
    const dt = Math.min(100, Math.max(0, now - this.lastT));
    this.lastT = now;
    const t = now / 1000;
    // Возбуждение — быстро вверх, медленно вниз; цель сама остывает к фону.
    this.exciteTarget += (0.25 - this.exciteTarget) * (1 - Math.exp(-dt / 2500));
    const up = this.exciteTarget > this.excite;
    this.excite += (this.exciteTarget - this.excite) * (1 - Math.exp(-dt / (up ? 120 : 900)));
    this.jump *= Math.exp(-dt / 700);
    const rate = now < this.burstUntil ? 0.06 : this.flashRate + 0.012 * this.excite;
    this.crowd.uniforms.uTime!.value = t;
    this.crowd.uniforms.uExcite!.value = this.excite;
    this.crowd.uniforms.uJump!.value = this.jump;
    this.flashes.uniforms.uTime!.value = t;
    this.flashes.uniforms.uRate!.value = rate;
    // Лучи по трибунам — медленно водят, сила — от возбуждения.
    const sweep: number[] = [];
    for (const b of this.beams) {
      if (b.speed) {
        const a = b.base + b.amp * Math.sin(t * b.speed + b.base * 3);
        b.mesh.rotation.z = a;
        sweep.push(a);
      }
    }
    (this.crowd.uniforms.uSweep!.value as Vector4).set(
      sweep[0] ?? 0,
      sweep[1] ?? 0,
      sweep[2] ?? 0,
      sweep[3] ?? 0,
    );
    this.led.offset.x = (t * 0.04) % 1;
  }

  /** Толпа реагирует: 0…1 (ох на попадание — 0,5, нокдаун — 1). */
  react(level: number): void {
    this.exciteTarget = Math.min(1, Math.max(this.exciteTarget, level));
    if (level >= 0.6) this.jump = Math.max(this.jump, level);
  }

  /** Залп вспышек фотокамер, мс. */
  flashBurst(ms: number): void {
    this.burstUntil = Math.max(this.burstUntil, this.lastT + ms);
  }

  /** Табло: имена, раунд, время, здоровье (перерисовываем только при изменении). */
  setScreen(s: {
    round: string;
    clock: string;
    me: number;
    bot: number;
    botName: string;
    big?: string;
  }): void {
    const key = `${s.round}|${s.clock}|${s.me}|${s.bot}|${s.botName}|${s.big ?? ''}`;
    if (key === this.screen.key) return;
    this.screen.key = key;
    drawScreen(this.screen.ctx, s);
    this.screen.tex.needsUpdate = true;
  }

  // ——— Ринг ———

  private buildRingPlatform(): Group {
    const g = new Group();
    const w = RING.x1 - RING.x0;
    const d = RING.z1 - RING.z0;
    const cx = (RING.x0 + RING.x1) / 2;
    const cz = (RING.z0 + RING.z1) / 2;
    // Канва — светлая, как на настоящем ринге под прожектором.
    const canvasTex = floorTexture();
    const floor = new Mesh(
      new PlaneGeometry(w + 0.7, d + 0.7),
      new MeshStandardMaterial({ map: canvasTex, roughness: 0.9, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    g.add(floor);
    // Юбка помоста — до пола зала, с логотипом.
    const skirtTex = skirtTexture();
    skirtTex.wrapS = RepeatWrapping;
    const skirtMat = new MeshStandardMaterial({
      map: skirtTex,
      roughness: 0.7,
      emissive: '#ffffff',
      emissiveMap: skirtTex,
      emissiveIntensity: 0.35,
    });
    const skirt = new Mesh(new BoxGeometry(w + 0.7, -FLOOR_Y, d + 0.7, 1, 1, 1), skirtMat);
    skirt.position.set(cx, FLOOR_Y / 2 - 0.001, cz);
    g.add(skirt);
    // Пол зала.
    const hall = new Mesh(new PlaneGeometry(80, 80), new MeshBasicMaterial({ color: '#070505' }));
    hall.rotation.x = -Math.PI / 2;
    hall.position.y = FLOOR_Y;
    g.add(hall);

    // Углы: стойки, мягкие накладки (красный и синий углы, нейтральные — белые), канаты.
    const corners: [number, number][] = [
      [RING.x0, RING.z0],
      [RING.x1, RING.z0],
      [RING.x1, RING.z1],
      [RING.x0, RING.z1],
    ];
    const postMat = new MeshStandardMaterial({ color: '#3f3f46', roughness: 0.35, metalness: 0.8 });
    const padColors = ['#d61f26', '#f4f4f5', '#1d4ed8', '#f4f4f5'];
    const padTex = padTexture();
    corners.forEach(([x, z], i) => {
      const post = new Mesh(new CylinderGeometry(0.045, 0.05, 1.55, 14), postMat);
      post.position.set(x, 0.775, z);
      const pad = new Mesh(
        new BoxGeometry(0.2, 1.18, 0.2, 1, 1, 1),
        new MeshStandardMaterial({
          color: padColors[i],
          map: padTex,
          roughness: 0.45,
          emissive: padColors[i],
          emissiveIntensity: 0.06,
        }),
      );
      pad.position.set(x, 0.86, z);
      // Накладка повёрнута по диагонали — к центру ринга.
      pad.rotation.y = Math.atan2(cx - x, cz - z);
      g.add(post, pad);
    });
    const ropeMat = new MeshStandardMaterial({
      color: '#f4f4f5',
      roughness: 0.35,
      emissive: '#ffffff',
      emissiveIntensity: 0.04,
    });
    const ropeRed = new MeshStandardMaterial({ color: '#d61f26', roughness: 0.4 });
    RING.ropes.forEach((h, i) => {
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k]!;
        const [bx, bz] = corners[(k + 1) % 4]!;
        const rope = new Mesh(new CylinderGeometry(0.019, 0.019, 1, 10), i === 1 ? ropeRed : ropeMat);
        stretch(rope, new Vector3(ax, h, az), new Vector3(bx, h, bz));
        g.add(rope);
      }
    });
    // Стяжки канатов посередине сторон.
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k]!;
      const [bx, bz] = corners[(k + 1) % 4]!;
      const tie = new Mesh(new BoxGeometry(0.05, RING.ropes.at(-1)! - RING.ropes[0]! + 0.08, 0.05), ropeMat);
      tie.position.set((ax + bx) / 2, (RING.ropes[0]! + RING.ropes.at(-1)!) / 2, (az + bz) / 2);
      g.add(tie);
    }
    return g;
  }

  private buildBeams(): void {
    // Неподвижные лучи сверху на ринг и подвижные — по трибунам.
    const mat = beamMaterial();
    const fixed: [number, number][] = [
      [-1.6, -1.8],
      [1.6, -1.8],
      [-1.6, 1.4],
      [1.6, 1.4],
    ];
    for (const [x, z] of fixed) {
      const m = new Mesh(new CylinderGeometry(0.12, 1.25, 9, 24, 1, true), mat);
      aimBeam(m, new Vector3(x * 2.2, 9.5, z * 2), new Vector3(x * 0.35, 0, z * 0.35 - 0.2));
      this.group.add(m);
      this.beams.push({ mesh: m, base: 0, speed: 0, amp: 0 });
    }
    // По трибунам: из-под крыши дальней стены.
    const sweepMat = beamMaterial(0.22, '#bfd6ff');
    for (let i = 0; i < 4; i++) {
      const pivot = new Group();
      const x = -9 + i * 6;
      pivot.position.set(x, 12, -21);
      const m = new Mesh(new CylinderGeometry(0.15, 2.4, 22, 20, 1, true), sweepMat);
      m.position.y = -11;
      pivot.add(m);
      pivot.rotation.x = -0.75;
      this.group.add(pivot);
      this.beams.push({
        mesh: pivot as unknown as Mesh,
        base: (i - 1.5) * 0.35,
        speed: 0.25 + i * 0.07,
        amp: 0.45,
      });
    }
  }
}

// ——— Трибуны и толпа ———

interface Seat {
  x: number;
  y: number;
  z: number;
  /** Угол от −Z (рад). */
  a: number;
  row: number;
}

function seatsOf(density: number): Seat[] {
  const out: Seat[] = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < STANDS.rows; row++) {
    const r = STANDS.r0 + row * STANDS.dr;
    const y = FLOOR_Y + 0.35 + row * STANDS.dy;
    const n = Math.floor((r * STANDS.spread * 2) / (STANDS.seat / density));
    for (let i = 0; i < n; i++) {
      const a = -STANDS.spread + ((i + 0.5) / n) * STANDS.spread * 2;
      // Проходы между секторами и редкие пустые места.
      const sector = (a / (STANDS.spread * 2) + 0.5) * 9;
      if (Math.abs(sector - Math.round(sector)) < 0.025) continue;
      if (rnd() < 0.05) continue;
      const jr = (rnd() - 0.5) * 0.18;
      const ja = ((rnd() - 0.5) * 0.2) / r;
      out.push({
        x: CENTER.x + Math.sin(a + ja) * (r + jr),
        y: y + (rnd() - 0.5) * 0.06,
        z: CENTER.z - Math.cos(a + ja) * (r + jr),
        a: a + ja,
        row,
      });
    }
  }
  return out;
}

/** Ступени трибун: тёмные ярусы под зрителями и стена за последним рядом. */
function buildStands(): Group {
  const g = new Group();
  // Без расчёта света: трибуны занимают пол-экрана, а освещает их всё равно толпа.
  const mat = new MeshBasicMaterial({ color: '#0d0a09', side: DoubleSide });
  const thetaStart = Math.PI - STANDS.spread - 0.1;
  const len = STANDS.spread * 2 + 0.2;
  for (let row = 0; row < STANDS.rows; row += 2) {
    const r = STANDS.r0 + row * STANDS.dr - 0.45;
    const y = FLOOR_Y + row * STANDS.dy;
    const step = new Mesh(
      new CylinderGeometry(r + STANDS.dr * 2, r, STANDS.dy * 2 + 0.02, 64, 1, true, thetaStart, len),
      mat,
    );
    step.position.set(CENTER.x, y + STANDS.dy, CENTER.z);
    g.add(step);
  }
  // Стена-ограждение перед первым рядом.
  const wall = new Mesh(
    new CylinderGeometry(STANDS.r0 - 0.5, STANDS.r0 - 0.5, 0.9, 64, 1, true, thetaStart, len),
    new MeshBasicMaterial({ color: '#080605', side: DoubleSide }),
  );
  wall.position.set(CENTER.x, FLOOR_Y + 0.45, CENTER.z);
  g.add(wall);
  // Купол зала — тёмный.
  const rTop = STANDS.r0 + STANDS.rows * STANDS.dr;
  const yTop = FLOOR_Y + STANDS.rows * STANDS.dy;
  const back = new Mesh(
    new CylinderGeometry(rTop + 0.5, rTop + 0.5, 22, 64, 1, true),
    new MeshBasicMaterial({ color: '#050403', side: DoubleSide }),
  );
  back.position.set(CENTER.x, yTop + 11 - 1, CENTER.z);
  g.add(back);
  const roof = new Mesh(
    new PlaneGeometry(90, 90),
    new MeshBasicMaterial({ color: '#040303', side: DoubleSide }),
  );
  roof.rotation.x = Math.PI / 2;
  roof.position.y = yTop + 18;
  g.add(roof);
  return g;
}

/** Атлас силуэтов: 8 типов зрителей × (сидит / руки вверх). Каналы: R — одежда, G — кожа, B — волосы. */
const ATLAS = { cols: 8, cw: 80, ch: 128 };

function crowdAtlas(): CanvasTexture {
  const [c, g] = canvas2d(ATLAS.cols * ATLAS.cw, ATLAS.ch * 2);
  const R = 'rgb(255,0,0)';
  const G = 'rgb(0,255,0)';
  const B = 'rgb(0,0,255)';
  for (let up = 0; up < 2; up++) {
    for (let i = 0; i < ATLAS.cols; i++) {
      g.save();
      // Верхняя половина картинки — v ∈ [0.5, 1] — «руки вверх» (см. шейдер).
      g.translate(i * ATLAS.cw, up ? 0 : ATLAS.ch);
      const cx = ATLAS.cw / 2 + ((i % 3) - 1) * 2;
      const wide = 1 + ((i * 37) % 5) * 0.05;
      const headY = 46 + (i % 2) * 4;
      const headR = 11 + (i % 3);
      // Плечи и торс.
      g.fillStyle = R;
      g.beginPath();
      g.moveTo(cx - 24 * wide, 128);
      g.lineTo(cx - 22 * wide, headY + 26);
      g.quadraticCurveTo(cx - 20 * wide, headY + 14, cx - 8, headY + 13);
      g.lineTo(cx + 8, headY + 13);
      g.quadraticCurveTo(cx + 20 * wide, headY + 14, cx + 22 * wide, headY + 26);
      g.lineTo(cx + 24 * wide, 128);
      g.closePath();
      g.fill();
      // Руки: подняты (болеют) или нет.
      if (up) {
        g.lineCap = 'round';
        g.lineWidth = 9;
        g.strokeStyle = R;
        const spread = 6 + (i % 4) * 4;
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(cx + s * 18 * wide, headY + 22);
          g.quadraticCurveTo(cx + s * (22 + spread), headY - 4, cx + s * (12 + spread), headY - 30);
          g.stroke();
          g.fillStyle = G;
          g.beginPath();
          g.arc(cx + s * (12 + spread), headY - 33, 5.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      // Шея и голова.
      g.fillStyle = G;
      g.fillRect(cx - 5, headY + 4, 10, 12);
      g.beginPath();
      g.ellipse(cx, headY, headR * 0.86, headR, 0, 0, Math.PI * 2);
      g.fill();
      // Волосы / кепка.
      g.fillStyle = B;
      g.beginPath();
      if (i % 4 === 1) {
        g.ellipse(cx, headY - headR * 0.45, headR * 0.98, headR * 0.6, 0, Math.PI, 0);
        g.fillRect(cx - 2, headY - headR * 0.6, headR + 6, 4);
      } else if (i % 4 === 3) {
        g.ellipse(cx, headY - 2, headR * 1.05, headR * 1.1, 0, Math.PI * 1.05, -0.05);
        g.fillRect(cx - headR, headY - 2, 5, 22);
        g.fillRect(cx + headR - 5, headY - 2, 5, 22);
      } else g.ellipse(cx, headY - headR * 0.35, headR * 0.9, headR * 0.7, 0, Math.PI, 0);
      g.fill();
      g.restore();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  return t;
}

function crowdMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uAtlas: { value: crowdAtlas() },
      uTime: { value: 0 },
      uExcite: { value: 0.25 },
      uJump: { value: 0 },
      uSweep: { value: new Vector4() },
      uHaze: { value: HAZE },
    },
    vertexShader: /* glsl */ `
      attribute vec3 iOffset;
      attribute float iAngle;
      attribute float iVar;
      attribute float iSeed;
      attribute vec3 iShirt;
      attribute vec3 iSkin;
      uniform float uTime;
      uniform float uExcite;
      uniform float uJump;
      uniform vec4 uSweep;
      varying vec2 vUv;
      varying vec3 vShirt;
      varying vec3 vSkin;
      varying float vLight;
      varying float vFog;
      varying float vHigh;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float temper = 0.35 + 0.65 * hash(iSeed * 7.31);
        float e = clamp(uExcite * temper * 1.35, 0.0, 1.0);
        // Руки вверх — у самых заведённых; держат не всё время, а волнами.
        float wave = 0.5 + 0.5 * sin(uTime * 2.2 + iSeed * 31.0);
        float up = step(1.0 - e * (0.6 + 0.4 * wave), hash(iSeed * 13.7) * 0.92 + 0.04);
        float freq = 5.0 + 5.0 * hash(iSeed * 3.1);
        float bob = abs(sin(uTime * freq + iSeed * 40.0));
        vec3 p = position;
        p.y += bob * (0.015 + 0.07 * e) + uJump * temper * 0.22 * abs(sin(uTime * 8.0 + iSeed * 20.0));
        p.x += sin(uTime * 1.3 + iSeed * 10.0) * 0.03 * (0.4 + e);
        float c = cos(iAngle);
        float s = sin(iAngle);
        vec3 w = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + iOffset;
        vUv = vec2((uv.x + iVar) / 8.0, (uv.y + up) * 0.5);
        vShirt = iShirt;
        vSkin = iSkin;
        // Свет: ближние ряды — от ринга, плюс пятна лучей, что ходят по трибунам.
        float row = clamp((length(iOffset.xz) - 7.0) / 20.0, 0.0, 1.0);
        float a = atan(iOffset.x, -iOffset.z);
        float spot = 0.0;
        for (int k = 0; k < 4; k++) {
          float d = a - uSweep[k] * 0.9;
          spot += exp(-d * d * 140.0) * smoothstep(0.1, 0.6, row);
        }
        float front = (1.0 - row) * (1.0 - row);
        vLight = (0.006 + 0.04 * front + 0.5 * spot + 0.012 * e) * (0.5 + 1.0 * hash(iSeed * 5.7));
        vHigh = row;
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        vFog = smoothstep(5.0, 30.0, -mv.z) * 0.8;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform vec3 uHaze;
      varying vec2 vUv;
      varying vec3 vShirt;
      varying vec3 vSkin;
      varying float vLight;
      varying float vFog;
      varying float vHigh;
      void main() {
        vec4 t = texture2D(uAtlas, vUv);
        if (t.a < 0.45) discard;
        vec3 col = t.r * vShirt + t.g * vSkin + t.b * vec3(0.04, 0.03, 0.025);
        col *= vLight;
        // Дальние верхние ряды тонут в дымке, подсвеченной лампами.
        col = mix(col, uHaze * (0.8 + 2.2 * vHigh), vFog);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

const SHIRTS = [
  '#e5e7eb',
  '#111827',
  '#991b1b',
  '#1e3a8a',
  '#374151',
  '#f97316',
  '#065f46',
  '#78350f',
  '#6b7280',
  '#fde68a',
  '#0f172a',
  '#b91c1c',
];
const SKINS = ['#f1c7a5', '#d9a07a', '#b97a56', '#8d5a3b', '#5c3a25', '#e8b896'];

function crowdMesh(seats: Seat[], mat: ShaderMaterial): Mesh {
  const base = new PlaneGeometry(0.66, 1.06);
  base.translate(0, 0.53, 0);
  const geo = new InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const n = seats.length;
  const off = new Float32Array(n * 3);
  const ang = new Float32Array(n);
  const vr = new Float32Array(n);
  const sd = new Float32Array(n);
  const shirt = new Float32Array(n * 3);
  const skin = new Float32Array(n * 3);
  const col = new Color();
  seats.forEach((s, i) => {
    off.set([s.x, s.y, s.z], i * 3);
    ang[i] = -s.a;
    const h = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    vr[i] = Math.floor(h * ATLAS.cols);
    sd[i] = (i * 0.618034) % 1;
    col.set(SHIRTS[Math.floor(((h * 97) % 1) * SHIRTS.length)]!).convertSRGBToLinear();
    shirt.set([col.r, col.g, col.b], i * 3);
    col.set(SKINS[Math.floor(((h * 53) % 1) * SKINS.length)]!).convertSRGBToLinear();
    skin.set([col.r, col.g, col.b], i * 3);
  });
  geo.setAttribute('iOffset', new InstancedBufferAttribute(off, 3));
  geo.setAttribute('iAngle', new InstancedBufferAttribute(ang, 1));
  geo.setAttribute('iVar', new InstancedBufferAttribute(vr, 1));
  geo.setAttribute('iSeed', new InstancedBufferAttribute(sd, 1));
  geo.setAttribute('iShirt', new InstancedBufferAttribute(shirt, 3));
  geo.setAttribute('iSkin', new InstancedBufferAttribute(skin, 3));
  geo.instanceCount = n;
  const m = new Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

// ——— Вспышки фотокамер ———

function flashMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uRate: { value: 0.003 }, uPx: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uRate;
      varying float vI;
      void main() {
        float tt = uTime * 3.0 + aSeed * 17.0;
        float slot = floor(tt);
        float h = fract(sin(slot * 12.9898 + aSeed * 78.233) * 43758.5453);
        float on = step(h, uRate) * exp(-fract(tt) * 16.0);
        vI = on;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = on > 0.02 ? (60.0 + 90.0 * on) * 4.0 / -mv.z : 0.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vI;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q) * 2.0;
        float core = exp(-d * d * 18.0);
        float glow = exp(-d * d * 3.0) * 0.35;
        float star = max(0.0, 1.0 - abs(q.y) * 40.0) * max(0.0, 1.0 - d) * 0.5
                   + max(0.0, 1.0 - abs(q.x) * 40.0) * max(0.0, 1.0 - d) * 0.3;
        float a = vI * (core + glow + star);
        gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * a * 2.2, a);
      }
    `,
  });
}

function flashPoints(seats: Seat[], mat: ShaderMaterial, n: number): Points {
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = seats[Math.floor(((i * 0.7548776662) % 1) * seats.length)]!;
    // Камера — в руках, чуть перед лицом, к рингу.
    pos.set([s.x - Math.sin(s.a) * 0.25, s.y + 0.95, s.z + Math.cos(s.a) * 0.25], i * 3);
    seed[i] = (i * 0.5698402909980532) % 1;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new BufferAttribute(seed, 1));
  const p = new Points(geo, mat);
  p.frustumCulled = false;
  return p;
}

// ——— Свет: лампы под крышей, лучи, дымка ———

function glowTexture(): CanvasTexture {
  const [c, g] = canvas2d(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.12, 'rgba(255,248,235,0.9)');
  r.addColorStop(0.35, 'rgba(255,230,200,0.22)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** Ряд ярких ламп под крышей по дальней стене и бокам (как на настоящей арене). */
function roofLamps(): Group {
  const g = new Group();
  const tex = glowTexture();
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    color: new Color(1.4, 1.3, 1.15),
  });
  const r = STANDS.r0 + STANDS.rows * STANDS.dr - 1;
  const y = FLOOR_Y + STANDS.rows * STANDS.dy + 1.8;
  const n = 26;
  const quad = new PlaneGeometry(1, 1);
  for (let i = 0; i < n; i++) {
    const a = -STANDS.spread + 0.15 + (i / (n - 1)) * (STANDS.spread * 2 - 0.3);
    const lamp = new Mesh(quad, mat);
    const big = i % 3 === 1;
    const s = big ? 3.4 : 2.2;
    lamp.scale.set(s, s, 1);
    lamp.position.set(CENTER.x + Math.sin(a) * r, y + (big ? 0.6 : 0), CENTER.z - Math.cos(a) * r);
    lamp.lookAt(0, 1.4, 1.4);
    g.add(lamp);
  }
  // Ферма над рингом с прожекторами.
  const truss = new MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.5, metalness: 0.7 });
  const H = 6.2;
  const sides: [number, number, number, number][] = [
    [-2.9, -3.1, 2.9, -3.1],
    [2.9, -3.1, 2.9, 2.6],
    [2.9, 2.6, -2.9, 2.6],
    [-2.9, 2.6, -2.9, -3.1],
  ];
  for (const [ax, az, bx, bz] of sides) {
    for (const dy of [0, 0.4]) {
      const bar = new Mesh(new CylinderGeometry(0.035, 0.035, 1, 8), truss);
      stretch(bar, new Vector3(ax, H + dy, az), new Vector3(bx, H + dy, bz));
      g.add(bar);
    }
  }
  const lensMat = new MeshBasicMaterial({ color: new Color(3, 2.8, 2.5), fog: false });
  for (const [x, z] of [
    [-1.8, -3.1],
    [0, -3.1],
    [1.8, -3.1],
    [-2.9, -0.4],
    [2.9, -0.4],
  ] as const) {
    const can = new Mesh(new CylinderGeometry(0.16, 0.2, 0.4, 16), truss);
    can.position.set(x, H - 0.25, z);
    const lens = new Mesh(new CylinderGeometry(0.15, 0.15, 0.02, 16), lensMat);
    lens.position.set(x, H - 0.46, z);
    const glow = new Mesh(quad, mat);
    glow.scale.set(1.6, 1.6, 1);
    glow.position.set(x, H - 0.5, z);
    glow.lookAt(0, 1.4, 1.4);
    g.add(can, lens, glow);
  }
  return g;
}

/** Луч света: открытый конус, яркий у источника и к центру, мягкие края. */
function beamMaterial(strength = 0.32, color = '#fff1dc'): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uStrength: { value: strength } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying float vH;
      varying float vEdge;
      void main() {
        vH = uv.y;
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vEdge = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vH;
      varying float vEdge;
      void main() {
        float a = uStrength * pow(vEdge, 2.5) * (0.25 + 0.75 * vH * vH);
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
}

/** Направить конус (ось Y, верх — источник) из from в to. */
function aimBeam(m: Mesh, from: Vector3, to: Vector3): void {
  const d = to.clone().sub(from);
  const len = d.length();
  m.scale.set(1, len / 9, 1);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize().negate());
}

/** Дымка в зале: пара больших плоскостей с мягким шумом. */
function haze(): Group {
  const g = new Group();
  const [c, ctx] = canvas2d(512, 256);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 512;
    const y = 60 + Math.random() * 160;
    const r = 30 + Math.random() * 90;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,236,215,${0.05 + Math.random() * 0.06})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new CanvasTexture(c);
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    opacity: 0.3,
  });
  for (const [z, y, w] of [[-13, 6, 44]] as const) {
    const p = new Mesh(new PlaneGeometry(w, w * 0.4), mat);
    p.position.set(0, y, z);
    g.add(p);
  }
  return g;
}

// ——— Табло и LED-борта ———

function jumbotron(parent: Group): { ctx: CanvasRenderingContext2D; tex: CanvasTexture; key: string } {
  const [c, ctx] = canvas2d(1024, 512);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const frame = new Mesh(
    new BoxGeometry(11.2, 5.9, 0.4),
    new MeshStandardMaterial({ color: '#111113', roughness: 0.6, metalness: 0.5 }),
  );
  const z = CENTER.z - (STANDS.r0 + STANDS.rows * STANDS.dr) + 1.2;
  const y = FLOOR_Y + STANDS.rows * STANDS.dy + 5.6;
  frame.position.set(0, y, z - 0.25);
  const screen = new Mesh(
    new PlaneGeometry(10.8, 5.5),
    new MeshBasicMaterial({ map: tex, color: new Color(1.25, 1.25, 1.25), fog: false }),
  );
  screen.position.set(0, y, z);
  parent.add(frame, screen);
  drawScreen(ctx, { round: 'FORMA', clock: '', me: 100, bot: 100, botName: '' });
  return { ctx, tex, key: '' };
}

function drawScreen(
  g: CanvasRenderingContext2D,
  s: { round: string; clock: string; me: number; bot: number; botName: string; big?: string },
): void {
  const W = 1024;
  const H = 512;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d1220');
  bg.addColorStop(1, '#05070d');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f97316';
  g.font = '800 44px Onest, system-ui, sans-serif';
  g.fillText('FORMA FIGHT NIGHT', W / 2, 52);
  if (s.big) {
    g.fillStyle = '#ffffff';
    g.font = '900 170px Onest, system-ui, sans-serif';
    g.fillText(s.big, W / 2, 270);
  } else {
    g.fillStyle = '#ffffff';
    g.font = '800 64px Onest, system-ui, sans-serif';
    g.fillText(s.round, W / 2, 150);
    g.font = '700 120px Onest, system-ui, sans-serif';
    g.fillText(s.clock, W / 2, 262);
  }
  // Здоровье: ты — красный угол, бот — синий.
  const bar = (x: number, w: number, v: number, color: string, label: string, right: boolean) => {
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(x, 392, w, 40);
    g.fillStyle = color;
    const fw = (w * Math.max(0, Math.min(100, v))) / 100;
    g.fillRect(right ? x + w - fw : x, 392, fw, 40);
    g.fillStyle = '#e5e7eb';
    g.font = '700 38px Onest, system-ui, sans-serif';
    g.textAlign = right ? 'right' : 'left';
    g.fillText(label, right ? x + w : x, 362);
  };
  bar(48, 420, s.me, '#ef4444', 'ТЫ', false);
  bar(W - 48 - 420, 420, s.bot, '#3b82f6', s.botName.toUpperCase(), true);
  g.textAlign = 'center';
  // Строки развёртки — как у настоящего экрана.
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
}

function ledTexture(): CanvasTexture {
  const [c, g] = canvas2d(2048, 64);
  g.fillStyle = '#050505';
  g.fillRect(0, 0, 2048, 64);
  g.font = '900 40px Onest, system-ui, sans-serif';
  g.textBaseline = 'middle';
  const items = [
    ['FORMA', '#f97316'],
    ['AI FITNESS COACH', '#ffffff'],
    ['FIGHT NIGHT', '#ef4444'],
    ['FORMA', '#f97316'],
    ['ТРЕНИРУЙСЯ С КАМЕРОЙ', '#93c5fd'],
  ] as const;
  let x = 30;
  for (const [t, col] of items) {
    g.fillStyle = col;
    g.fillText(t, x, 34);
    x += g.measureText(t).width + 90;
  }
  // Точки светодиодов.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < 64; y += 3) g.fillRect(0, y, 2048, 1);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  return t;
}

/** LED-борта перед трибунами — бегущая строка. */
function ledBoards(tex: CanvasTexture): Mesh {
  const r = STANDS.r0 - 0.55;
  const len = STANDS.spread * 2 + 0.2;
  // Изнутри цилиндра текстура зеркальная — переворачиваем.
  tex.repeat.set(-4, 1);
  const m = new Mesh(
    new CylinderGeometry(r, r, 0.62, 96, 1, true, Math.PI - STANDS.spread - 0.1, len),
    new MeshBasicMaterial({ map: tex, side: DoubleSide, color: new Color(1.3, 1.3, 1.3) }),
  );
  m.position.set(CENTER.x, FLOOR_Y + 0.55, CENTER.z);
  return m;
}

// ——— Текстуры ринга ———

function floorTexture(): CanvasTexture {
  const [c, g] = canvas2d(1024, 1024);
  const bg = g.createRadialGradient(512, 512, 60, 512, 512, 760);
  bg.addColorStop(0, '#d9d6d0');
  bg.addColorStop(1, '#a9a5a0');
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 1024);
  // Фактура и потёртости.
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
  }
  for (let i = 0; i < 40; i++) {
    const x = 200 + Math.random() * 620;
    const y = 200 + Math.random() * 620;
    const r = 20 + Math.random() * 60;
    const s = g.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, 'rgba(60,50,40,0.06)');
    s.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = s;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(249,115,22,0.75)';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(512, 512, 210, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(17,17,20,0.55)';
  g.font = '900 130px Onest, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('FORMA', 512, 512);
  g.font = '800 54px Onest, system-ui, sans-serif';
  g.fillStyle = 'rgba(214,31,38,0.6)';
  g.save();
  g.translate(512, 120);
  g.fillText('FIGHT NIGHT', 0, 0);
  g.restore();
  g.save();
  g.translate(512, 904);
  g.rotate(Math.PI);
  g.fillText('FIGHT NIGHT', 0, 0);
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 16;
  g.strokeRect(20, 20, 984, 984);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function skirtTexture(): CanvasTexture {
  const [c, g] = canvas2d(512, 128);
  g.fillStyle = '#0b0b0d';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#f97316';
  g.font = '900 64px Onest, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('FORMA', 256, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function padTexture(): CanvasTexture {
  const [c, g] = canvas2d(128, 512);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 512);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 300, 128, 20);
  g.save();
  g.translate(64, 160);
  g.rotate(-Math.PI / 2);
  g.fillStyle = 'rgba(17,17,20,0.85)';
  g.font = '900 52px Onest, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('FORMA', 0, 0);
  g.restore();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// ——— Мелочи ———

/** Цилиндр высотой 1 по оси Y — растянуть между двумя точками. */
export function stretch(m: Object3D, a: Vector3, b: Vector3): void {
  const d = b.clone().sub(a);
  const len = d.length();
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  m.scale.set(1, len, 1);
}

export function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}
