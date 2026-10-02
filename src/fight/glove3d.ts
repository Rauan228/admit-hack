// Твои руки в бою от первого лица (U-25): боксёрская перчатка и голая рука вместо шаров и чёрных цилиндров.
// Перчатка — сфера, вылепленная в форму: костяшки вперёд, сверху выпуклая, ладонь плоская, пальцы подогнуты
// валиком внизу, к запястью сужается; большой палец прижат сбоку; манжета с липучкой и логотипом; белый кант
// по шву между верхом и ладонью. Кожа — лак с мелкой фактурой (карта нормалей из шума), блики
// от прожекторов — из карты окружения сцены. Рука — телесная, с рельефом предплечья и бинтом у запястья.
//
// Координаты перчатки: начало — запястье, кулак — вперёд по −Z, верх (тыльная сторона) — +Y.

import {
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  DoubleSide,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three';
import { canvas2d } from './arena';

export interface ArmMeshes {
  glove: Group;
  upper: Mesh;
  fore: Mesh;
  elbow: Mesh;
}

/** Размеры перчатки (полуоси), м: ширина, высота, длина; центр кулака — впереди запястья. */
const G = { rx: 0.058, ry: 0.052, rz: 0.082, cz: -0.088 };

let leather: { normal: CanvasTexture; rough: CanvasTexture } | null = null;

/** Перчатка и рука одной стороны: dir −1 — левая, 1 — правая. */
export function makeArm(dir: -1 | 1, upperLen: number, foreLen: number, color = '#c8141c'): ArmMeshes {
  leather ??= leatherMaps();
  // Лак кожи — стандартный материал с низкой шероховатостью и бликами из карты окружения (clearcoat и sheen
  // физического материала на пол-экрана перчаток слабой видеокарте не по силам).
  const red = new MeshStandardMaterial({
    color,
    side: DoubleSide,
    roughness: 0.3,
    roughnessMap: leather.rough,
    metalness: 0.05,
    normalMap: leather.normal,
    normalScale: new Vector2(0.35, 0.35),
    emissive: new Color(color).multiplyScalar(0.06),
  });
  const glove = new Group();

  // Тело перчатки.
  const body = new Mesh(gloveBody(), red);
  body.position.z = G.cz;
  // Логотип на тыльной стороне.
  const logo = new Mesh(
    logoPatch(),
    new MeshStandardMaterial({
      map: logoTexture(),
      transparent: true,
      roughness: 0.35,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  logo.position.z = G.cz;
  // Большой палец — прижат к внутренней стороне, сверху-сбоку.
  const thumb = new Mesh(new SphereGeometry(1, 24, 16), red);
  thumb.scale.set(0.021, 0.024, 0.05);
  thumb.position.set(-dir * 0.05, 0.004, -0.07);
  thumb.rotation.set(0.12, -dir * 0.32, -dir * 0.5);
  // Кант по шву.
  const piping = new Mesh(seamGeometry(), new MeshStandardMaterial({ color: '#f5f5f4', roughness: 0.4 }));
  piping.position.z = G.cz;
  glove.add(body, logo, thumb, piping);

  // Манжета: профиль вращения от запястья к локтю (ось — Z).
  const cuff = new Mesh(
    lathe([
      [0.0, 0.038],
      [0.006, 0.047],
      [0.02, 0.05],
      [0.07, 0.049],
      [0.115, 0.047],
      [0.13, 0.044],
      [0.135, 0.036],
    ]),
    red,
  );
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = -0.012;
  // Край манжеты со стороны локтя — тёмная подкладка вокруг руки (иначе видно, что внутри пусто).
  const lining = new Mesh(
    new RingGeometry(0.03, 0.037, 32),
    new MeshBasicMaterial({ color: '#140a0a', side: DoubleSide }),
  );
  lining.position.z = 0.123;
  // Липучка: широкая полоса другого цвета с логотипом.
  const strapMat = new MeshStandardMaterial({ color: '#111114', roughness: 0.55, map: strapTexture() });
  const strap = new Mesh(new CylinderGeometry(0.0515, 0.0505, 0.06, 40, 1, true), strapMat);
  strap.rotation.x = Math.PI / 2;
  strap.position.z = 0.055;
  strap.rotation.y = 0;
  const edge = new Mesh(new CylinderGeometry(0.0522, 0.0522, 0.006, 40, 1, true), piping.material);
  edge.rotation.x = Math.PI / 2;
  edge.position.z = 0.024;
  const edge2 = edge.clone();
  edge2.position.z = 0.086;
  glove.add(cuff, lining, strap, edge, edge2);

  // Рука: кожа, предплечье с рельефом и бинт у запястья, плечо.
  const skin = new MeshStandardMaterial({ color: '#c99474', roughness: 0.55 });
  // Ось рук — Y от начала (локоть / плечо) к концу (кисть / локоть), см. place в fpv.ts.
  const along = (pts: [number, number][], len: number) =>
    lathe(pts.map(([t, r]) => [t * len - len / 2, r] as [number, number]));
  const fore = new Mesh(
    along(
      [
        [0, 0.041],
        [0.18, 0.046],
        [0.42, 0.047],
        [0.8, 0.039],
        [1, 0.035],
      ],
      foreLen,
    ),
    skin,
  );
  const upper = new Mesh(
    along(
      [
        [0, 0.05],
        [0.35, 0.055],
        [0.75, 0.05],
        [1, 0.043],
      ],
      upperLen,
    ),
    skin,
  );
  skin.side = DoubleSide;
  const elbow = new Mesh(new SphereGeometry(0.043, 20, 14), skin);
  return { glove, upper, fore, elbow };
}

/**
 * Тело перчатки — деформированная сфера. Вход — направление единичной сферы, выход — точка поверхности
 * (центр кулака — начало координат).
 */
function shape(d: Vector3): Vector3 {
  let { x, y, z } = d;
  // Ладонь плоская, верх выпуклый.
  if (y < 0) y *= 0.78;
  // К запястью (z > 0) сужается, спереди — полнее.
  const back = Math.max(0, z);
  x *= 1 - 0.18 * back;
  y *= 1 - 0.12 * back;
  // Костяшки: передняя верхняя часть шире и выдаётся вперёд.
  const front = Math.max(0, -z);
  z -= 0.08 * front * Math.max(0, y + 0.3);
  // Подогнутые пальцы: снизу спереди — валик, чуть внутрь.
  if (y < -0.2 && z < 0) z += 0.12 * (-y - 0.2) * -z;
  // Сверху чуть сплюснуто по бокам — не яйцо, а перчатка.
  x *= 1 - 0.06 * Math.max(0, y);
  return new Vector3(x * G.rx, y * G.ry, z * G.rz);
}

function gloveBody(): BufferGeometry {
  const g = new SphereGeometry(1, 56, 40);
  const p = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const s = shape(v);
    p.setXYZ(i, s.x, s.y, s.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Шов между верхом и ладонью — по поверхности тела, чуть ниже середины. */
function seamGeometry(): BufferGeometry {
  const pts: Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const d = new Vector3(Math.cos(a), -0.12, Math.sin(a)).normalize();
    pts.push(shape(d).multiplyScalar(1.004));
  }
  return new TubeGeometry(new CatmullRomCurve3(pts, true), 128, 0.0024, 8, true);
}

/** Пятно логотипа — кусок той же поверхности сверху (повторяет форму, чуть над ней). */
function logoPatch(): BufferGeometry {
  // Сфера по умолчанию: полюс — +Y; верх перчатки — +Y, так что «шапка» у полюса и есть тыльная сторона.
  const g = new SphereGeometry(1, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.36);
  const p = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const s = shape(v).multiplyScalar(1.006);
    p.setXYZ(i, s.x, s.y, s.z);
    // Свои координаты текстуры: по x и z точки (вид сверху).
    uv.setXY(i, 0.5 - s.x / (G.rx * 1.3), 0.5 - s.z / (G.rz * 1.2));
  }
  g.computeVertexNormals();
  return g;
}

function logoTexture(): CanvasTexture {
  const [c, g] = canvas2d(256, 256);
  g.clearRect(0, 0, 256, 256);
  g.translate(128, 128);
  // Надпись поперёк кулака, читается тобой (верх букв — к костяшкам); u растёт к −x — отражаем.
  g.scale(-1, 1);
  g.fillStyle = '#ffffff';
  g.font = '900 64px Onest, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('FORMA', 0, 0);
  g.fillStyle = '#f97316';
  g.fillRect(-70, 34, 140, 8);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function strapTexture(): CanvasTexture {
  const [c, g] = canvas2d(512, 64);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#d4d4d8';
  for (let x = 0; x < 512; x += 6) g.fillRect(x, 0, 2, 64);
  g.fillStyle = '#f97316';
  g.font = '900 34px Onest, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('FORMA', 384, 34);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Тело вращения по профилю [высота по оси Y, радиус]. */
function lathe(profile: [number, number][]): BufferGeometry {
  return new LatheGeometry(
    profile.map(([h, r]) => new Vector2(r, h)),
    32,
  );
}

/** Фактура кожи: шум → карта нормалей и шероховатости. */
function leatherMaps(): { normal: CanvasTexture; rough: CanvasTexture } {
  const N = 256;
  const h = new Float32Array(N * N);
  // Несколько октав «зерна»: мелкие поры и складки.
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let o = 0; o < 3; o++) {
    const cells = 12 << o;
    const grid = Array.from({ length: (cells + 1) * (cells + 1) }, rnd);
    const amp = 1 / (1 + o * 1.4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const gx = (x / N) * cells;
        const gy = (y / N) * cells;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = gx - ix;
        const fy = gy - iy;
        const at = (i: number, j: number) => grid[(j % cells) * (cells + 1) + (i % cells)]!;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const v =
          at(ix, iy) * (1 - sx) * (1 - sy) +
          at(ix + 1, iy) * sx * (1 - sy) +
          at(ix, iy + 1) * (1 - sx) * sy +
          at(ix + 1, iy + 1) * sx * sy;
        h[y * N + x]! += v * amp;
      }
    }
  }
  const [nc, ng] = canvas2d(N, N);
  const [rc, rg] = canvas2d(N, N);
  const nimg = ng.createImageData(N, N);
  const rimg = rg.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const H = (i: number, j: number) => h[((j + N) % N) * N + ((i + N) % N)]!;
      const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2;
      const dy = (H(x, y + 1) - H(x, y - 1)) * 2.2;
      const len = Math.hypot(dx, dy, 1);
      const k = (y * N + x) * 4;
      nimg.data[k] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[k + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      nimg.data[k + 2] = (1 / len) * 255;
      nimg.data[k + 3] = 255;
      const r = 150 + (H(x, y) - 1) * 80;
      rimg.data[k] = rimg.data[k + 1] = rimg.data[k + 2] = Math.max(0, Math.min(255, r));
      rimg.data[k + 3] = 255;
    }
  }
  ng.putImageData(nimg, 0, 0);
  rg.putImageData(rimg, 0, 0);
  const normal = new CanvasTexture(nc);
  const rough = new CanvasTexture(rc);
  for (const t of [normal, rough]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(3, 3);
  }
  return { normal, rough };
}
