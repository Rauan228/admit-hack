// Модель позы в фоновом потоке (poseWorker.ts). MediaPipe на GPU после каждого кадра синхронно читает
// результат с видеокарты (readPixels) и ждёт, пока она доделает всё, что в очереди, — включая 3D страницы.
// На основном потоке это съедало до 80 % времени кадра (бой от первого лица: 16–22 FPS на ноутбуке);
// здесь ждёт только этот поток, а страница рисует.
//
// Протокол: init → ready | error; frame (пиксели кадра, ts) → result (точки выбранного человека или null).

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { PersonSelector } from './person';
import { nextTimestamp, toLandmarks, toWorld, type PoseDelegate } from './pose';
import { ShadowLift } from './shadow';
import type { Landmark } from './types';

export interface PoseWorkerInit {
  type: 'init';
  wasmBaseUrl: string;
  model: Uint8Array;
  delegate: PoseDelegate;
  numPoses: number;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
  shadowLift: boolean;
}

export type PoseWorkerFrame =
  /** Кадр камеры целиком (WebCodecs): уменьшаем до width и снимаем пиксели здесь. */
  | { type: 'frame'; frame: VideoFrame; width: number; ts: number; image?: undefined }
  /** Уже уменьшенный кадр пикселями (без WebCodecs). */
  | { type: 'frame'; image: ImageData; ts: number; frame?: undefined };

export type PoseWorkerReply =
  | { type: 'ready'; delegate: PoseDelegate }
  | { type: 'error'; message: string }
  | {
      type: 'result';
      ts: number;
      image: Landmark[] | null;
      world: { x: number; y: number; z: number }[] | null;
      /** Сколько считала модель (без ожидания в очереди), мс. */
      ms: number;
      /** Из них — снять пиксели кадра, мс. */
      grabMs?: number;
    };

const scope = self as unknown as {
  importScripts?: (url: string) => void;
  postMessage(msg: PoseWorkerReply): void;
  onmessage: ((e: MessageEvent<PoseWorkerInit | PoseWorkerFrame>) => void) | null;
};

// MediaPipe грузит свой загрузчик wasm через importScripts. В модульном воркере (dev-сервер Vite) его нет —
// подставляем синхронную загрузку с выполнением в глобальной области (иначе ModuleFactory не виден).
try {
  // Без аргументов в обычном воркере — ничего не делает, в модульном — бросает TypeError.
  (scope.importScripts as (() => void) | undefined)?.();
} catch {
  scope.importScripts = (url: string) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    if (xhr.status >= 400) throw new Error(`importScripts: HTTP ${xhr.status} ${url}`);
    (0, eval)(xhr.responseText);
  };
}

let landmarker: PoseLandmarker | null = null;
let shadow: ShadowLift | null = null;
const selector = new PersonSelector();
let last: Landmark[] | null = null;
let lastTs = -1;
let pix: OffscreenCanvasRenderingContext2D | null = null;

async function init(m: PoseWorkerInit): Promise<PoseDelegate> {
  const fileset = await FilesetResolver.forVisionTasks(m.wasmBaseUrl);
  const create = (delegate: PoseDelegate) =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: m.model, delegate },
      runningMode: 'VIDEO',
      numPoses: m.numPoses,
      minPoseDetectionConfidence: m.minPoseDetectionConfidence,
      minPosePresenceConfidence: m.minPosePresenceConfidence,
      minTrackingConfidence: m.minTrackingConfidence,
      // GPU в воркере — свой холст вне страницы.
      ...(delegate === 'GPU' ? { canvas: new OffscreenCanvas(1, 1) } : {}),
    });
  let delegate = m.delegate;
  try {
    landmarker = await create(delegate);
  } catch (err) {
    if (delegate === 'CPU') throw err;
    delegate = 'CPU';
    landmarker = await create(delegate);
  }
  shadow = m.shadowLift ? new ShadowLift() : null;
  return delegate;
}

let grab: OffscreenCanvasRenderingContext2D | null = null;

/** VideoFrame → уменьшенные пиксели (холст в памяти процессора), кадр закрываем. */
function toPixels(vf: VideoFrame, width: number): ImageData {
  try {
    const scale = Math.min(1, width / Math.max(1, vf.displayWidth));
    const w = Math.max(1, Math.round(vf.displayWidth * scale));
    const h = Math.max(1, Math.round(vf.displayHeight * scale));
    if (!grab || grab.canvas.width !== w || grab.canvas.height !== h) {
      grab = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
      if (!grab) throw new Error('нет 2D-холста в воркере');
    }
    grab.drawImage(vf, 0, 0, w, h);
    return grab.getImageData(0, 0, w, h);
  } finally {
    vf.close();
  }
}

/** VideoFrame → пиксели асинхронным копированием (без ожидания видеокарты); не умеет — через холст. */
async function framePixels(vf: VideoFrame, width: number): Promise<ImageData> {
  if (copyOk) {
    try {
      const w = vf.displayWidth;
      const h = vf.displayHeight;
      const buf = new Uint8ClampedArray(w * h * 4);
      await vf.copyTo(buf, { format: 'RGBA' } as VideoFrameCopyToOptions);
      vf.close();
      return new ImageData(buf, w, h);
    } catch {
      copyOk = false;
    }
  }
  return toPixels(vf, width);
}
let copyOk = true;

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    init(m)
      .then((delegate) => scope.postMessage({ type: 'ready', delegate }))
      .catch((err: unknown) => scope.postMessage({ type: 'error', message: String(err) }));
    return;
  }
  void detect(m);
};

async function detect(m: PoseWorkerFrame): Promise<void> {
  const { ts } = m;
  try {
    if (!landmarker) throw new Error('модель не готова');
    const t0 = performance.now();
    const frame = m.image ?? (await framePixels(m.frame, m.width));
    grabMs = performance.now() - t0;
    lastTs = nextTimestamp(lastTs, ts);
    let input: ImageData | OffscreenCanvas = frame;
    if (shadow) {
      // Подсветка теней работает с холстом: кладём кадр на холст воркера.
      pix ??= new OffscreenCanvas(frame.width, frame.height).getContext('2d', { willReadFrequently: true });
      if (pix) {
        if (pix.canvas.width !== frame.width || pix.canvas.height !== frame.height) {
          pix.canvas.width = frame.width;
          pix.canvas.height = frame.height;
        }
        pix.putImageData(frame, 0, 0);
        const lifted = shadow.prepare(pix.canvas, last, lastTs);
        if (lifted !== pix.canvas && 'getContext' in lifted) input = lifted as OffscreenCanvas;
      }
    }
    const result = landmarker.detectForVideo(input, lastTs);
    const people = result.landmarks.filter((p) => p.length > 0).map(toLandmarks);
    const i = selector.pick(people);
    const image = people[i] ?? null;
    last = image;
    scope.postMessage({
      type: 'result',
      ts,
      image,
      world: image ? toWorld(result.worldLandmarks[i]) : null,
      ms: performance.now() - t0,
      grabMs,
    });
  } catch (err) {
    scope.postMessage({ type: 'error', message: String(err) });
  }
}
let grabMs = 0;
