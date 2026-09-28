// Детектор позы: MediaPipe Tasks Vision PoseLandmarker.
// GPU берём только на аппаратном WebGL; если его нет или GPU падает при создании — CPU.
// Модель и wasm грузятся с CDN.

import type {
  Landmark as MpWorldLandmark,
  NormalizedLandmark,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import { ENGINE_CONFIG, type PoseModel } from './config';
import { PersonSelector } from './person';
import type { Vec3 } from './geometry';
import type { Landmark } from './types';

export type PoseDelegate = 'GPU' | 'CPU';

/** Результат детекции одного человека. */
export interface PoseDetection {
  /** 33 нормализованные точки (формат контракта). */
  image: Landmark[];
  /** 33 точки в метрах, начало координат между бёдер; null, если модель их не дала. */
  world: Vec3[] | null;
}

export interface PoseDetector {
  readonly delegate: PoseDelegate;
  readonly model: PoseModel;
  /** Человек в кадре или null, если никого нет. */
  detect(video: HTMLVideoElement, timestampMs: number): PoseDetection | null;
  close(): void;
}

export interface PoseDetectorOptions {
  model?: PoseModel;
  /** Принудительно CPU: для отладки и слабых устройств. */
  delegate?: PoseDelegate;
  /** Сколько людей искать в кадре (по умолчанию из конфига). */
  numPoses?: number;
}

/** Приводит точки MediaPipe к формату контракта (visibility → v). */
export function toLandmarks(points: readonly NormalizedLandmark[]): Landmark[] {
  return points.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 0 }));
}

/** Мировые точки MediaPipe → Vec3 (метры). */
export function toWorld(points: readonly MpWorldLandmark[] | undefined): Vec3[] | null {
  if (!points || points.length === 0) return null;
  return points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

/**
 * MediaPipe в режиме VIDEO требует строго возрастающих меток времени.
 * performance.now() может совпасть на двух вызовах подряд — сдвигаем на 1 мс.
 */
export function nextTimestamp(lastMs: number, nowMs: number): number {
  return nowMs > lastMs ? nowMs : lastMs + 1;
}

/**
 * Программный WebGL (SwiftShader, llvmpipe) формально «GPU», но медленнее CPU примерно в 12 раз:
 * замер на ноутбуке — 630 мс против 52 мс на кадр. Такой GPU не падает, а тормозит, поэтому ловим заранее.
 */
export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(renderer);
}

/** Имя WebGL-рендерера или null, если WebGL нет вовсе (тогда GPU-делегат точно не заработает). */
function webglRenderer(): string | null {
  if (typeof document === 'undefined') return null;
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
}

/** GPU, только если есть настоящий аппаратный WebGL2. */
export function preferredDelegate(renderer: string | null = webglRenderer()): PoseDelegate {
  return renderer && !isSoftwareRenderer(renderer) ? 'GPU' : 'CPU';
}

export async function createPoseDetector(options: PoseDetectorOptions = {}): Promise<PoseDetector> {
  const cfg = ENGINE_CONFIG.pose;
  const modelFor = (delegate: PoseDelegate): PoseModel =>
    options.model ?? (delegate === 'GPU' ? cfg.model : cfg.cpuModel);
  // Динамический импорт: MediaPipe (~1 МБ) не попадает в бандл, пока UI работает на моке.
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(cfg.wasmBaseUrl);

  const create = (delegate: PoseDelegate) =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: cfg.modelUrls[modelFor(delegate)], delegate },
      runningMode: 'VIDEO',
      numPoses: options.numPoses ?? (delegate === 'GPU' ? cfg.numPosesGpu : cfg.numPosesCpu),
      minPoseDetectionConfidence: cfg.minPoseDetectionConfidence,
      minPosePresenceConfidence: cfg.minPosePresenceConfidence,
      minTrackingConfidence: cfg.minTrackingConfidence,
    });

  let landmarker: PoseLandmarker;
  let delegate: PoseDelegate = options.delegate ?? preferredDelegate();
  try {
    landmarker = await create(delegate);
  } catch (err) {
    if (delegate === 'CPU') throw err;
    console.warn('[pose] GPU недоступен, переключаюсь на CPU', err);
    delegate = 'CPU';
    landmarker = await create(delegate);
  }

  let lastTs = -1;
  const selector = new PersonSelector();
  return {
    delegate,
    model: modelFor(delegate),
    detect(video, timestampMs) {
      lastTs = nextTimestamp(lastTs, timestampMs);
      const result = landmarker.detectForVideo(video, lastTs);
      const people = result.landmarks.filter((p) => p.length > 0).map(toLandmarks);
      const i = selector.pick(people);
      const image = people[i];
      if (!image) return null;
      return { image, world: toWorld(result.worldLandmarks[i]) };
    },
    close() {
      landmarker.close();
    },
  };
}
