// Детектор позы: MediaPipe Tasks Vision PoseLandmarker.
// GPU берём только на аппаратном WebGL; если его нет или GPU падает при создании — CPU.
// Модель и wasm грузятся с CDN.

import type { NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision';
import { ENGINE_CONFIG, type PoseModel } from './config';
import type { Landmark } from './types';

export type PoseDelegate = 'GPU' | 'CPU';

export interface PoseDetector {
  readonly delegate: PoseDelegate;
  readonly model: PoseModel;
  /** 33 точки первого человека в кадре или null, если никого нет. */
  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null;
  close(): void;
}

export interface PoseDetectorOptions {
  model?: PoseModel;
  /** Принудительно CPU: для отладки и слабых устройств. */
  delegate?: PoseDelegate;
}

/** Приводит точки MediaPipe к формату контракта (visibility → v). */
export function toLandmarks(points: readonly NormalizedLandmark[]): Landmark[] {
  return points.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 0 }));
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
      numPoses: cfg.numPoses,
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
  return {
    delegate,
    model: modelFor(delegate),
    detect(video, timestampMs) {
      lastTs = nextTimestamp(lastTs, timestampMs);
      const result = landmarker.detectForVideo(video, lastTs);
      const first = result.landmarks[0];
      return first && first.length > 0 ? toLandmarks(first) : null;
    },
    close() {
      landmarker.close();
    },
  };
}
