// Кисть: кулак или раскрытая ладонь (E-36). У модели позы на кисть всего три точки (костяшки указательного,
// мизинца и большой палец) — по ним кулак от ладони не отличить. Поэтому в момент удара на вырезку кадра
// вокруг кисти запускается MediaPipe Hand Landmarker (21 точка), и по 3D-точкам считаем, согнуты ли пальцы.
//
// Запускается только пока идёт удар (счётчик не в исходном положении) и только для бьющей руки: модель
// кисти — лишние 5–20 мс на кадр, в стойке они не нужны. Кисть не найдена, далеко, в перчатке — «неизвестно»,
// и удар считается (fail-open): страдать от слабой камеры не должен честный боксёр. Запрещает удар только
// уверенная раскрытая ладонь.

import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { ENGINE_CONFIG } from './config';
import type { PoseFrame, Vec3 } from './geometry';
import { LM } from './hints';
import { loadPoseModel, preferredDelegate, type PoseDelegate } from './pose';
import type { FrameSource } from './snapshot';
import type { Side } from './types';

export type HandState = 'fist' | 'open' | 'unknown';

/** Состояние кисти, когда оно измерено и сколько проверок подряд дали это же состояние. */
export interface HandSample {
  state: HandState;
  t: number;
  streak: number;
}

/** Вырезка кадра вокруг кисти, доли ширины и высоты кадра. */
export interface HandRoi {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HandDetector {
  readonly delegate: PoseDelegate;
  /** Кулак, ладонь или неизвестно — по вырезке roi из кадра source. */
  detect(source: FrameSource, roi: HandRoi): HandState;
  close(): void;
}

/** Пальцы Hand Landmarker: [основание (MCP), сустав (PIP), кончик]. Большой палец не считаем — в кулаке он сбоку. */
const FINGERS: readonly [number, number, number][] = [
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
];

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Кулак или ладонь по 21 3D-точке кисти (метры, Hand Landmarker worldLandmarks).
 * Палец разогнут, если кончик дальше от запястья, чем основание, в ≥ extended раз (прямой палец ~1,8);
 * согнут — если не дальше чем в curled раз (в кулаке кончик лежит у основания, ~1,0–1,2).
 * Кулак — не меньше трёх согнутых и ни одного разогнутого; ладонь — не меньше трёх разогнутых.
 */
export function classifyHand(
  world: readonly Vec3[],
  th: { curled: number; extended: number } = ENGINE_CONFIG.hands.finger,
): HandState {
  const wrist = world[0];
  if (!wrist || world.length < 21) return 'unknown';
  let curled = 0;
  let extended = 0;
  for (const [mcp, , tip] of FINGERS) {
    const base = dist(world[mcp]!, wrist);
    if (!(base > 1e-4)) continue;
    const ratio = dist(world[tip]!, wrist) / base;
    if (ratio <= th.curled) curled += 1;
    else if (ratio >= th.extended) extended += 1;
  }
  if (curled >= 3 && extended === 0) return 'fist';
  if (extended >= 3) return 'open';
  return 'unknown';
}

const HAND_POINTS: Record<Side, { wrist: number; index: number; pinky: number }> = {
  left: { wrist: LM.leftWrist, index: 19, pinky: 17 },
  right: { wrist: LM.rightWrist, index: 20, pinky: 18 },
};

/**
 * Квадрат вокруг кисти по точкам позы: центр — между запястьем и костяшками, сторона — roiScale размеров
 * кисти (запястье–костяшка указательного), но не меньше minRoiPx. null — запястья не видно.
 * Размер в пикселях нужен, чтобы квадрат был квадратом и в кадре 4:3, и в 16:9.
 */
export function handRoi(
  frame: PoseFrame,
  side: Side,
  srcW: number,
  srcH: number,
  cfg: { roiScale: number; minRoiPx: number } = ENGINE_CONFIG.hands,
): HandRoi | null {
  const ids = HAND_POINTS[side];
  const wrist = frame.image[ids.wrist];
  if (!wrist || wrist.v < 0.3 || !(srcW > 0) || !(srcH > 0)) return null;
  const px = (i: number) => {
    const p = frame.image[i];
    return p && p.v >= 0.3 ? { x: p.x * srcW, y: p.y * srcH } : null;
  };
  const w = px(ids.wrist)!;
  const index = px(ids.index);
  const pinky = px(ids.pinky);
  const knuckles =
    index && pinky ? { x: (index.x + pinky.x) / 2, y: (index.y + pinky.y) / 2 } : (index ?? pinky);
  const center = knuckles ? { x: (w.x + knuckles.x) / 2, y: (w.y + knuckles.y) / 2 } : w;
  const hand = knuckles ? Math.hypot(knuckles.x - w.x, knuckles.y - w.y) : 0;
  const size = Math.max(cfg.minRoiPx, hand * cfg.roiScale);
  const x0 = Math.max(0, Math.min(srcW - size, center.x - size / 2));
  const y0 = Math.max(0, Math.min(srcH - size, center.y - size / 2));
  const sw = Math.min(size, srcW);
  const sh = Math.min(size, srcH);
  return { x: x0 / srcW, y: y0 / srcH, w: sw / srcW, h: sh / srcH };
}

export interface HandDetectorOptions {
  delegate?: PoseDelegate;
}

/** Hand Landmarker на вырезке кадра: модель и wasm — с CDN, как у позы. */
export async function createHandDetector(options: HandDetectorOptions = {}): Promise<HandDetector> {
  const cfg = ENGINE_CONFIG.hands;
  const { FilesetResolver, HandLandmarker: Landmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(ENGINE_CONFIG.pose.wasmBaseUrl);
  const modelAssetBuffer = await loadPoseModel(cfg.modelUrl);
  const create = (delegate: PoseDelegate) =>
    Landmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer, delegate },
      runningMode: 'IMAGE',
      numHands: 1,
      minHandDetectionConfidence: cfg.minConfidence,
      minHandPresenceConfidence: cfg.minConfidence,
    });
  let delegate: PoseDelegate = options.delegate ?? preferredDelegate();
  let landmarker: HandLandmarker;
  try {
    landmarker = await create(delegate);
  } catch (err) {
    if (delegate === 'CPU') throw err;
    console.warn('[hands] GPU недоступен, переключаюсь на CPU', err);
    delegate = 'CPU';
    landmarker = await create(delegate);
  }
  const canvas = document.createElement('canvas');
  canvas.width = cfg.inputPx;
  canvas.height = cfg.inputPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('кисти: нет 2D-контекста для вырезки');
  // Прогрев: первый вызов на GPU компилирует шейдеры (замер — 650 мс), лучше здесь, чем на первом ударе.
  try {
    landmarker.detect(canvas);
  } catch {
    /* пустой холст модели не нравится — не страшно */
  }
  return {
    delegate,
    detect(source, roi) {
      const size =
        'videoWidth' in source
          ? { w: source.videoWidth, h: source.videoHeight }
          : { w: source.width, h: source.height };
      ctx.drawImage(
        source,
        roi.x * size.w,
        roi.y * size.h,
        roi.w * size.w,
        roi.h * size.h,
        0,
        0,
        cfg.inputPx,
        cfg.inputPx,
      );
      const result = landmarker.detect(canvas);
      const world = result.worldLandmarks[0];
      const score = result.handedness[0]?.[0]?.score ?? 0;
      if (!world || world.length < 21 || score < cfg.minConfidence) return 'unknown';
      return classifyHand(world);
    },
    close() {
      landmarker.close();
    },
  };
}
