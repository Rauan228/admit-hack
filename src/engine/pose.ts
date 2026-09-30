// Детектор позы: MediaPipe Tasks Vision PoseLandmarker.
// GPU берём только на аппаратном WebGL; если его нет или GPU падает при создании — CPU.
// Модель и wasm грузятся с CDN.

import type {
  Landmark as MpWorldLandmark,
  NormalizedLandmark,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import { ENGINE_CONFIG, type PoseModel } from './config';
import { isMobileDevice } from './perf';
import { PersonSelector } from './person';
import { ShadowLift } from './shadow';
import { FrameSnapshots } from './snapshot';
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
  /** Снимок кадра, на котором посчитаны последние точки (snapshot.ts); нет — экран рисует видео. */
  readonly frame?: HTMLCanvasElement | null;
  close(): void;
}

export interface PoseDetectorOptions {
  model?: PoseModel;
  /** Принудительно CPU: для отладки и слабых устройств. */
  delegate?: PoseDelegate;
  /** Сколько людей искать в кадре (по умолчанию из конфига). */
  numPoses?: number;
  /** Подсветка теней перед моделью (по умолчанию из конфига). */
  shadowLift?: boolean;
  /** Снимок кадра для модели и экрана (по умолчанию из конфига). */
  snapshot?: boolean;
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

/** Модель под устройство: на телефоне и без GPU — lite, full — только на компьютере с видеокартой. */
function defaultModel(delegate: PoseDelegate): PoseModel {
  const cfg = ENGINE_CONFIG.pose;
  return delegate === 'GPU' && !isMobileDevice() ? cfg.model : cfg.cpuModel;
}

/**
 * Байты модели позы (E-34): одна загрузка на страницу — её берут и предзагрузка (пока человек в меню),
 * и детектор. Сорвалась — забываем, следующая попытка качает заново.
 */
const modelLoads = new Map<string, Promise<Uint8Array>>();

export function loadPoseModel(url: string): Promise<Uint8Array> {
  let load = modelLoads.get(url);
  if (!load) {
    load = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`модель позы: HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => new Uint8Array(buf));
    modelLoads.set(url, load);
    load.catch(() => modelLoads.delete(url));
  }
  return load;
}

/**
 * Подкачать заранее то, что нужно движку: модель под это устройство и wasm MediaPipe (E-34).
 * Пока человек читает лендинг, 9 МБ модели и 3 МБ wasm уже едут — «Начать» включает камеру почти сразу.
 */
export function prefetchPoseAssets(): void {
  const cfg = ENGINE_CONFIG.pose;
  loadPoseModel(cfg.modelUrls[defaultModel(preferredDelegate())]).catch(() => undefined);
  // wasm кэшируется браузером на год — достаточно скачать; MediaPipe потом возьмёт его из кэша.
  for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'])
    fetch(`${cfg.wasmBaseUrl}/${file}`)
      .then((res) => res.arrayBuffer())
      .catch(() => undefined);
}

/**
 * Предзагрузка в простое страницы: после загрузки страницы и её собственных тяжёлых файлов, чтобы не
 * отбирать канал у них (на лендинге и в меню — 3D-атлет: ждём его модель, но не дольше maxWaitMs).
 * При «экономии трафика» и на 2G — не качаем 9 МБ без спроса.
 */
export function prefetchPoseAssetsWhenIdle(
  opts: { after?: RegExp; maxWaitMs?: number; delayMs?: number } = {},
): void {
  if (typeof window === 'undefined') return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (conn?.saveData || /2g/.test(conn?.effectiveType ?? '')) return;
  const { after, maxWaitMs = 12_000, delayMs = 1000 } = opts;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    setTimeout(prefetchPoseAssets, delayMs);
  };
  const afterLoad = () => {
    if (!after) return start();
    const done = () => performance.getEntriesByType('resource').some((e) => after.test(e.name));
    if (done()) return start();
    const watch = new PerformanceObserver(() => {
      if (!done()) return;
      watch.disconnect();
      start();
    });
    watch.observe({ type: 'resource', buffered: true });
    setTimeout(() => {
      watch.disconnect();
      start();
    }, maxWaitMs);
  };
  if (document.readyState === 'complete') afterLoad();
  else window.addEventListener('load', afterLoad, { once: true });
}

export async function createPoseDetector(options: PoseDetectorOptions = {}): Promise<PoseDetector> {
  const cfg = ENGINE_CONFIG.pose;
  const modelFor = (delegate: PoseDelegate): PoseModel => options.model ?? defaultModel(delegate);
  let delegate: PoseDelegate = options.delegate ?? preferredDelegate();
  // Модель — сразу, параллельно с wasm: сам MediaPipe качает её только после wasm (на 4G это +3,5 с к старту).
  loadPoseModel(cfg.modelUrls[modelFor(delegate)]).catch(() => undefined);
  // Динамический импорт: MediaPipe (~1 МБ) не попадает в бандл, пока UI работает на моке.
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(cfg.wasmBaseUrl);

  const create = async (delegate: PoseDelegate) => {
    const url = cfg.modelUrls[modelFor(delegate)];
    const modelAssetBuffer = await loadPoseModel(url);
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer, delegate },
      runningMode: 'VIDEO',
      numPoses: options.numPoses ?? (delegate === 'GPU' ? cfg.numPosesGpu : cfg.numPosesCpu),
      minPoseDetectionConfidence: cfg.minPoseDetectionConfidence,
      minPosePresenceConfidence: cfg.minPosePresenceConfidence,
      minTrackingConfidence: cfg.minTrackingConfidence,
    });
    // MediaPipe скопировал модель к себе — 5–9 МБ в памяти страницы больше не держим (есть HTTP-кэш).
    modelLoads.delete(url);
    return landmarker;
  };

  let landmarker: PoseLandmarker;
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
  const shadow = (options.shadowLift ?? cfg.shadowLift.enabled) ? new ShadowLift() : null;
  const snapshots = (options.snapshot ?? cfg.frameSnapshot) ? new FrameSnapshots() : null;
  let last: Landmark[] | null = null;
  return {
    delegate,
    model: modelFor(delegate),
    get frame() {
      return snapshots?.frame ?? null;
    },
    detect(video, timestampMs) {
      lastTs = nextTimestamp(lastTs, timestampMs);
      // Модель и экран берут один и тот же снимок кадра: видео могло бы смениться посреди детекции.
      const snap = snapshots?.capture(video) ?? null;
      const source = snap ?? video;
      const input = shadow ? shadow.prepare(source, last, lastTs) : source;
      const result = landmarker.detectForVideo(input, lastTs);
      if (snap) snapshots?.commit();
      const people = result.landmarks.filter((p) => p.length > 0).map(toLandmarks);
      const i = selector.pick(people);
      const image = people[i];
      last = image ?? null;
      if (!image) return null;
      return { image, world: toWorld(result.worldLandmarks[i]) };
    },
    close() {
      landmarker.close();
    },
  };
}
