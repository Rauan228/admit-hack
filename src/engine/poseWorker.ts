// Детектор позы в фоновых потоках (pose.worker.ts). Тот же контракт PoseDetector, но кадр уходит в воркер,
// а точки приходят обратно (detectAsync): основной поток не ждёт ни модель, ни видеокарту.
//
// Почему так (замеры на ноутбуке i5-12500H + Iris Xe, бой от первого лица с человеком в кадре):
// - на основном потоке MediaPipe синхронно читает результат с видеокарты (readPixels) и ждёт её очередь
//   вместе с 3D страницы: экран 15–18 FPS, распознавание 16–20 кадров/с;
// - в воркере на GPU модель считала 170–260 мс на кадр (медленный путь видеокарты вне страницы);
// - в воркере на CPU (wasm) — ~75 мс; кадр уходит как VideoFrame, пиксели — асинхронным copyTo (4 мс,
//   без ожидания видеокарты). Два воркера считают кадры по очереди: экран ~60 FPS, распознавание ~25.
// Ответы отдаём строго по порядку кадров. Снимок кадра для экрана (snapshot.ts) — здесь, на основном потоке.
// Воркер не поднялся — бросаем, движок берёт обычный детектор.

import { ENGINE_CONFIG } from './config';
import { isMobileDevice } from './perf';
import {
  defaultModel,
  loadPoseModel,
  type PoseDelegate,
  type PoseDetection,
  type PoseDetector,
  type PoseDetectorOptions,
} from './pose';
import type { PoseWorkerFrame, PoseWorkerInit, PoseWorkerReply } from './pose.worker';
import { FrameSnapshots, sourceSize } from './snapshot';

/**
 * Модель в фоне — на компьютере с WebCodecs и хотя бы 4 ядрами. Телефону wasm на процессоре медленнее его
 * видеокарты на основном потоке — у него остаётся прежний детектор.
 */
export function poseWorkerSupported(nav: Navigator | undefined = globalThis.navigator): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    !isMobileDevice(nav) &&
    (nav?.hardwareConcurrency ?? 0) >= 4
  );
}

/** Сколько воркеров: два, если ядер хватает (каждый занимает одно ядро целиком). */
export function poseWorkerCount(nav: Navigator | undefined = globalThis.navigator): number {
  return (nav?.hardwareConcurrency ?? 0) >= 8 ? ENGINE_CONFIG.pose.workerCount : 1;
}

/** Один воркер с моделью: запросы по одному, ответы по порядку. */
class PoseWorkerClient {
  private readonly worker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });
  private readonly waiting: { resolve: (r: PoseWorkerReply) => void; reject: (e: Error) => void }[] = [];

  constructor() {
    this.worker.onerror = (e) => this.failAll(`воркер позы: ${e.message}`);
    this.worker.onmessage = (e: MessageEvent<PoseWorkerReply>) => {
      const w = this.waiting.shift();
      if (!w) return;
      if (e.data.type === 'error') w.reject(new Error(e.data.message));
      else w.resolve(e.data);
    };
  }

  get busy(): number {
    return this.waiting.length;
  }

  ask(msg: PoseWorkerInit | PoseWorkerFrame, transfer: Transferable[], timeoutMs: number) {
    return new Promise<PoseWorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => this.failAll('воркер позы не ответил'), timeoutMs);
      this.waiting.push({
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.worker.postMessage(msg, transfer);
    });
  }

  failAll(message: string): void {
    for (const w of this.waiting.splice(0)) w.reject(new Error(message));
  }

  close(): void {
    this.failAll('детектор закрыт');
    this.worker.terminate();
  }
}

export async function createWorkerPoseDetector(options: PoseDetectorOptions = {}): Promise<PoseDetector> {
  const cfg = ENGINE_CONFIG.pose;
  const wanted: PoseDelegate = options.delegate ?? cfg.workerDelegate;
  const model = options.model ?? defaultModel(wanted);
  // Байты модели — из общей загрузки страницы (её начинает предзагрузка); каждому воркеру — копия.
  const bytes = await loadPoseModel(cfg.modelUrls[model]);
  const pool = Array.from({ length: poseWorkerCount() }, () => new PoseWorkerClient());
  let delegate = wanted;
  try {
    const replies = await Promise.all(
      pool.map((w) => {
        const copy = bytes.slice();
        const init: PoseWorkerInit = {
          type: 'init',
          wasmBaseUrl: cfg.wasmBaseUrl,
          model: copy,
          delegate: wanted,
          numPoses: options.numPoses ?? (wanted === 'GPU' ? cfg.numPosesGpu : cfg.numPosesCpu),
          minPoseDetectionConfidence: cfg.minPoseDetectionConfidence,
          minPosePresenceConfidence: cfg.minPosePresenceConfidence,
          minTrackingConfidence: cfg.minTrackingConfidence,
          shadowLift: options.shadowLift ?? cfg.shadowLift.enabled,
        };
        return w.ask(init, [copy.buffer], cfg.workerInitTimeoutMs);
      }),
    );
    const ready = replies.find((r) => r.type === 'ready');
    if (ready?.type === 'ready') delegate = ready.delegate;
    console.info(`[pose] модель ${model} в фоне: ${pool.length} × ${delegate}`);
  } catch (err) {
    for (const w of pool) w.close();
    throw err;
  }

  const snapshots =
    (options.snapshot ?? cfg.frameSnapshot) ? new FrameSnapshots(undefined, pool.length + 1) : null;
  let costMs = 0;
  let pix: OffscreenCanvasRenderingContext2D | null = null;
  let sent = 0;
  /** Ответ предыдущего кадра: следующий отдаём не раньше (воркеры могут закончить не по порядку). */
  let previous: Promise<unknown> = Promise.resolve();

  const toMessage = (video: HTMLVideoElement, snap: HTMLCanvasElement | null, ts: number) => {
    if (typeof VideoFrame !== 'undefined') {
      const frame = new VideoFrame(video, { timestamp: Math.round(ts * 1000) });
      return {
        msg: { type: 'frame', frame, width: cfg.workerFrameWidth, ts } as PoseWorkerFrame,
        transfer: [frame],
      };
    }
    // Без WebCodecs — пиксели уменьшенной копии с холста здесь.
    const src = snap ?? video;
    const { w, h } = sourceSize(src);
    const scale = Math.min(1, cfg.workerFrameWidth / Math.max(1, w));
    const fw = Math.max(1, Math.round(w * scale));
    const fh = Math.max(1, Math.round(h * scale));
    if (!pix || pix.canvas.width !== fw || pix.canvas.height !== fh) {
      pix = new OffscreenCanvas(fw, fh).getContext('2d', { willReadFrequently: true });
      if (!pix) throw new Error('нет 2D-холста');
    }
    pix.drawImage(src, 0, 0, fw, fh);
    const image = pix.getImageData(0, 0, fw, fh);
    return { msg: { type: 'frame', image, ts } as PoseWorkerFrame, transfer: [image.data.buffer] };
  };

  return {
    delegate,
    model,
    inFlightLimit: pool.length,
    get frame() {
      return snapshots?.frame ?? null;
    },
    get lastCostMs() {
      return costMs;
    },
    detect() {
      throw new Error('детектор в воркере — только detectAsync');
    },
    async detectAsync(video, timestampMs): Promise<PoseDetection | null> {
      // Модель и экран берут один и тот же снимок кадра: видео могло бы смениться, пока модель думает.
      const snap = snapshots?.captureNext(video) ?? null;
      const { msg, transfer } = toMessage(video, snap, timestampMs);
      // Кадры по очереди по воркерам; первый кадр каждого — прогрев, ему время запуска.
      const n = sent++;
      const worker = pool[n % pool.length]!;
      const timeout = n < pool.length ? cfg.workerInitTimeoutMs : cfg.workerFrameTimeoutMs;
      const reply = worker.ask(msg, transfer, timeout);
      const before = previous;
      previous = reply.catch(() => undefined);
      const r = await reply;
      await before;
      if (r.type !== 'result') return null;
      costMs = r.ms;
      if (snap) snapshots?.commitFrame(snap);
      return r.image ? { image: r.image, world: r.world } : null;
    },
    close() {
      for (const w of pool) w.close();
    },
  };
}
