// Сборка 3D-бойца для боя с ботом (dev/boxer-build.html → scripts/build-boxer.mjs → public/models/boxer.glb).
//
// Основа — Microsoft Rocketbox «Sports_Male_01» (MIT, github.com/microsoft/Microsoft-Rocketbox): реалистичный
// спортсмен со скелетом Biped. Дальше — в духе спортивных аркад: фигура чуть мощнее (плечи, руки, шея
// «накачаны» прямо в геометрии — вершины отодвигаются от оси кости, сгибы не перекашивает), и экипировка
// синего угла — шлем, атласные трусы с поясом и лампасами, высокие боксёрки. Экипировка — оболочки самого тела:
// треугольники нужного участка копируются, отодвигаются по нормали и получают тот же скелет и те же веса —
// сидят по фигуре и двигаются вместе с ней. Узор — маленькая текстура в своей развёртке (угол вокруг тела,
// высота), края прозрачные: пояс, подол, лампасы и вырез шлема ровные.
//
// Исходники (не в git): .cache/boxer/Sports_Male_01/Sports_Male_01.fbx и текстуры, уменьшенные до 1024
// (цвет — jpg, нормали — png). Результат — window.__glb (base64).

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LoadingManager,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  SkinnedMesh,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const NAME = 'Sports_Male_01';
const BASE = `/.cache/boxer/${NAME}/`;

/** Цвета синего угла. */
const BLUE = new Color('#1f56f0');
const WHITE = new Color('#f4f6fb');
const SOLE = new Color('#16181d');

/** Насколько «накачать» (во сколько раз дальше от оси кости), по костям. */
const BULK: Record<string, number> = {
  Bip01_L_UpperArm: 1.14,
  Bip01_R_UpperArm: 1.14,
  Bip01_L_Forearm: 1.1,
  Bip01_R_Forearm: 1.1,
  Bip01_L_Clavicle: 1.1,
  Bip01_R_Clavicle: 1.1,
  Bip01_Neck: 1.16,
  Bip01_Spine2: 1.05,
  Bip01_L_Thigh: 1.05,
  Bip01_R_Thigh: 1.05,
  Bip01_L_Calf: 1.06,
  Bip01_R_Calf: 1.06,
};

const log: string[] = [];

async function build(): Promise<string> {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    const file = url.split(/[\\/]/).pop()!;
    if (/\.tga$/i.test(file)) return BASE + file.replace(/\.tga$/i, /normal/i.test(file) ? '.png' : '.jpg');
    return url;
  });
  // Текстуры FBXLoader догружает после модели — ждём, пока менеджер дочитает всё.
  const allLoaded = new Promise<void>((done) => (manager.onLoad = done));
  const root = await new FBXLoader(manager).loadAsync(`${BASE}${NAME}.fbx`);
  await allLoaded;
  root.animations = [];
  root.updateMatrixWorld(true);
  let body: SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) body = o as SkinnedMesh;
  });
  if (!body) throw new Error('нет SkinnedMesh');
  const mesh = body as SkinnedMesh;
  mesh.name = 'boxer_body';

  // Кожа: PBR, текстуры — jpg в GLB.
  const skin = (src: Material): Material => {
    const s = src as Material & { map?: Texture | null; normalMap?: Texture | null };
    for (const t of [s.map, s.normalMap]) if (t) t.userData.mimeType = 'image/jpeg';
    if (s.map) s.map.colorSpace = SRGBColorSpace;
    return new MeshStandardMaterial({
      name: /head/.test(s.name) ? 'boxer_head' : 'boxer_skin',
      map: s.map ?? null,
      normalMap: s.normalMap ?? null,
      roughness: 0.5,
      metalness: 0,
    });
  };
  mesh.material = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(skin);

  const geo = mesh.geometry;
  const pos = geo.attributes.position as BufferAttribute;
  const nrm = geo.attributes.normal as BufferAttribute;
  const si = geo.attributes.skinIndex as BufferAttribute;
  const sw = geo.attributes.skinWeight as BufferAttribute;
  const bones = mesh.skeleton.bones;
  const n = pos.count;

  // Проверка: в исходной позе скиннинг — тождество (геометрия = поза покоя в осях меша).
  let maxDev = 0;
  const a = new Vector3();
  const b = new Vector3();
  for (let i = 0; i < n; i += 97) {
    mesh.getVertexPosition(i, a);
    b.fromBufferAttribute(pos, i);
    maxDev = Math.max(maxDev, a.distanceTo(b));
  }
  log.push(`скиннинг в покое: max отклонение ${maxDev.toFixed(4)}`);

  // Мир ↔ меш (в покое): см.
  const toWorld = (v: Vector3) => v.clone().applyMatrix4(mesh.matrixWorld);
  const jointLocal = (name: string) => {
    const bone = bones.find((x) => x.name === name);
    if (!bone) throw new Error(`нет кости ${name}`);
    return mesh.worldToLocal(bone.getWorldPosition(new Vector3()));
  };
  const childOf: Record<string, string> = {
    Bip01_L_UpperArm: 'Bip01_L_Forearm',
    Bip01_R_UpperArm: 'Bip01_R_Forearm',
    Bip01_L_Forearm: 'Bip01_L_Hand',
    Bip01_R_Forearm: 'Bip01_R_Hand',
    Bip01_L_Clavicle: 'Bip01_L_UpperArm',
    Bip01_R_Clavicle: 'Bip01_R_UpperArm',
    Bip01_Neck: 'Bip01_Head',
    Bip01_Spine2: 'Bip01_Neck',
    Bip01_L_Thigh: 'Bip01_L_Calf',
    Bip01_R_Thigh: 'Bip01_R_Calf',
    Bip01_L_Calf: 'Bip01_L_Foot',
    Bip01_R_Calf: 'Bip01_R_Foot',
  };
  const axes = new Map<number, { p0: Vector3; d: Vector3; k: number }>();
  bones.forEach((bone, i) => {
    const k = BULK[bone.name];
    if (!k) return;
    const p0 = jointLocal(bone.name);
    const d = jointLocal(childOf[bone.name]!).sub(p0).normalize();
    axes.set(i, { p0, d, k });
  });
  const headIdx = bones.findIndex((x) => x.name === 'Bip01_Head');

  // 1) Фигура мощнее: каждая вершина отходит от оси своих костей пропорционально весу.
  let moved = 0;
  const v = new Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    let headW = 0;
    const shift = new Vector3();
    for (let j = 0; j < 4; j++) {
      const w = sw.getComponent(i, j);
      const bi = si.getComponent(i, j);
      if (bi === headIdx) headW += w;
      const ax = axes.get(bi);
      if (!ax || w <= 0) continue;
      const t = v.clone().sub(ax.p0).dot(ax.d);
      const radial = v.clone().sub(ax.p0).sub(ax.d.clone().multiplyScalar(t));
      shift.addScaledVector(radial, (ax.k - 1) * w);
    }
    if (headW > 0.4 || shift.lengthSq() === 0) continue;
    v.add(shift);
    pos.setXYZ(i, v.x, v.y, v.z);
    moved += 1;
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
  log.push(`накачано вершин: ${moved} из ${n}`);

  // Какой материал у треугольника.
  const matOf = new Int8Array(n / 3);
  for (const g of geo.groups)
    for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) matOf[t] = g.materialIndex ?? 0;

  // 2) Экипировка — оболочки по нормали. У каждой — своя развёртка (угол вокруг тела или ноги, высота) и
  // узор в маленькой текстуре: края — прозрачные (alphaTest), поэтому пояс, подол, лампасы и вырез шлема
  // ровные, а не по зубцам треугольников. Берём треугольники с запасом — лишнее срежет прозрачность.
  const P = (i: number) => toWorld(new Vector3().fromBufferAttribute(pos, i));
  type RGBA = [number, number, number, number];
  const rgba = (c: Color, a = 1): RGBA => [c.r, c.g, c.b, a];
  const CLEAR: RGBA = [0, 0, 0, 0];
  interface Garment {
    name: string;
    offset: number;
    /** Треугольник подходит (точки в см, материал 0 — тело, 1 — голова). */
    pick: (p: Vector3[], mat: number) => boolean;
    /** Развёртка: угол θ, градусы (−180…180), и высота y, см. */
    angle: (p: Vector3) => number;
    y0: number;
    y1: number;
    paint: (theta: number, y: number) => RGBA;
    material: MeshPhysicalMaterial;
  }
  const deg = (r: number) => (r * 180) / Math.PI;
  /** Угол вокруг оси ноги (зеркально для правой): +90° — снаружи, −90° — внутри, 0 — спереди. */
  const legAngle = (p: Vector3, cx: number, cz: number) => deg(Math.atan2(Math.abs(p.x) - cx, p.z - cz));
  const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const garments: Garment[] = [
    {
      // Атласные трусы: синие, белый пояс с синей полосой, белый подол, белые лампасы снаружи.
      name: 'boxer_trunks',
      offset: 1.1,
      pick: (p, mat) =>
        mat === 0 && p.some((q) => q.y > 58 && q.y < 103.5) && p.every((q) => Math.abs(q.x) < 24),
      angle: (p) => {
        const body = deg(Math.atan2(Math.abs(p.x), p.z));
        const leg = legAngle(p, 9.5, 0.5);
        return leg + (body - leg) * smoothstep(76, 86, p.y);
      },
      y0: 56,
      y1: 104,
      paint: (th, y) => {
        if (y > 101.5 || y < 60.2) return CLEAR;
        if (y >= 96.6) return rgba(y > 98.5 && y < 99.5 ? BLUE : WHITE);
        if (y < 62.4) return rgba(WHITE);
        const side = Math.abs(th - 90);
        if (side < 5.5) return rgba(side < 1.5 ? BLUE : WHITE);
        return rgba(BLUE);
      },
      material: new MeshPhysicalMaterial({
        name: 'boxer_trunks',
        roughness: 0.32,
        sheen: 0.8,
        sheenRoughness: 0.3,
        sheenColor: new Color('#a9c6ff'),
        clearcoat: 0.12,
      }),
    },
    {
      // Высокие боксёрки: белые, синий верх и полоса сбоку, шнуровка спереди, тёмная подошва.
      name: 'boxer_boots',
      offset: 0.55,
      pick: (p, mat) => mat === 0 && p.some((q) => q.y < 26.5),
      angle: (p) => legAngle(p, 11.3, 1.5),
      y0: -1,
      y1: 28,
      paint: (th, y) => {
        if (y > 24.5) return CLEAR;
        if (y < 3) return rgba(SOLE);
        if (y > 21.2) return rgba(BLUE);
        if (Math.abs(th) < 15 && y > 6 && y < 21) return rgba((y * 10) % 20 < 4.5 ? SOLE : WHITE);
        if (Math.abs(th - 90) < 7 && y > 4.5 && y < 19) return rgba(BLUE);
        return rgba(WHITE);
      },
      material: new MeshPhysicalMaterial({ name: 'boxer_boots', roughness: 0.42, clearcoat: 0.2 }),
    },
    {
      // Шлем: синий, открытое лицо (щёки прикрыты), белый кант по вырезу и снизу.
      name: 'boxer_headgear',
      offset: 1.7,
      pick: (p, mat) => mat === 1 && p.some((q) => q.y > 153),
      angle: (p) => deg(Math.atan2(Math.abs(p.x), p.z - 2.5)),
      y0: 150,
      y1: 186,
      paint: (th, y) => {
        const halfFace = y > 165 ? 60 : 46;
        const bottom = th < 100 ? 156.5 : 158.8;
        if (y < bottom) return CLEAR;
        if (th < halfFace && y < 171.3) return CLEAR;
        if (y < bottom + 1.3) return rgba(WHITE);
        if (th < halfFace + 7 && y < 172.6) return rgba(WHITE);
        return rgba(BLUE);
      },
      material: new MeshPhysicalMaterial({ name: 'boxer_headgear', roughness: 0.38, clearcoat: 0.45 }),
    },
  ];

  const tex = (g: Garment): CanvasTexture => {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    for (let r = 0; r < S; r++) {
      // flipY: строка 0 — верх картинки = v = 1.
      const y = g.y0 + (1 - (r + 0.5) / S) * (g.y1 - g.y0);
      for (let col = 0; col < S; col++) {
        const th = ((col + 0.5) / S) * 360 - 180;
        const [cr, cg, cb, ca] = g.paint(th, y);
        const o = (r * S + col) * 4;
        // Цвет — в sRGB (текстура цвета).
        const srgb = new Color(cr, cg, cb).convertLinearToSRGB();
        img.data[o] = Math.round(srgb.r * 255);
        img.data[o + 1] = Math.round(srgb.g * 255);
        img.data[o + 2] = Math.round(srgb.b * 255);
        img.data[o + 3] = Math.round(ca * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    t.name = `${g.name}_pattern`;
    return t;
  };

  for (const g of garments) {
    const tris: number[] = [];
    for (let t = 0; t < n / 3; t++)
      if (g.pick([P(3 * t), P(3 * t + 1), P(3 * t + 2)], matOf[t]!)) tris.push(t);
    const m = tris.length * 3;
    const out = {
      position: new Float32Array(m * 3),
      normal: new Float32Array(m * 3),
      uv: new Float32Array(m * 2),
      skinIndex: new Uint16Array(m * 4),
      skinWeight: new Float32Array(m * 4),
    };
    let k = 0;
    for (const t of tris) {
      // Развёртка треугольника: u не должен перескакивать через шов (−180/180) — сдвигаем на оборот.
      const us = [0, 1, 2].map((c) => (g.angle(P(3 * t + c)) + 180) / 360);
      if (Math.max(...us) - Math.min(...us) > 0.5) for (let c = 0; c < 3; c++) if (us[c]! < 0.5) us[c]! += 1;
      for (let c = 0; c < 3; c++) {
        const i = 3 * t + c;
        const p = new Vector3().fromBufferAttribute(pos, i);
        const nl = new Vector3().fromBufferAttribute(nrm, i);
        p.addScaledVector(nl, g.offset);
        out.position.set([p.x, p.y, p.z], k * 3);
        out.normal.set([nl.x, nl.y, nl.z], k * 3);
        out.uv.set([us[c]!, (P(i).y - g.y0) / (g.y1 - g.y0)], k * 2);
        for (let j = 0; j < 4; j++) {
          out.skinIndex[k * 4 + j] = si.getComponent(i, j);
          out.skinWeight[k * 4 + j] = sw.getComponent(i, j);
        }
        k++;
      }
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(out.position, 3));
    geom.setAttribute('normal', new BufferAttribute(out.normal, 3));
    geom.setAttribute('uv', new BufferAttribute(out.uv, 2));
    geom.setAttribute('skinIndex', new BufferAttribute(out.skinIndex, 4));
    geom.setAttribute('skinWeight', new BufferAttribute(out.skinWeight, 4));
    g.material.map = tex(g);
    g.material.alphaTest = 0.5;
    const s = new SkinnedMesh(mergeVertices(geom, 1e-4), g.material);
    s.name = g.name;
    s.position.copy(mesh.position);
    s.quaternion.copy(mesh.quaternion);
    s.scale.copy(mesh.scale);
    mesh.parent!.add(s);
    s.bind(mesh.skeleton, mesh.bindMatrix);
    log.push(`${g.name}: ${tris.length} треугольников`);
  }

  // Тело — индексированное (меньше файл).
  const merged = mergeVertices(geo, 1e-4);
  mesh.geometry = merged;
  log.push(`тело: ${n} → ${merged.attributes.position!.count} вершин`);

  // В GLB — метры.
  root.scale.setScalar(0.01);
  root.name = 'boxer';
  root.updateMatrixWorld(true);
  const glb = (await new GLTFExporter().parseAsync(root as Object3D, { binary: true })) as ArrayBuffer;
  log.push(`GLB: ${(glb.byteLength / 1024).toFixed(0)} КБ`);
  let s = '';
  const bytes = new Uint8Array(glb);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const w = window as unknown as { __glb?: string; __log?: string[]; __error?: string };
build()
  .then((b64) => {
    w.__log = log;
    w.__glb = b64;
  })
  .catch((err: unknown) => {
    w.__log = log;
    w.__error = String((err as Error)?.stack ?? err);
  });
