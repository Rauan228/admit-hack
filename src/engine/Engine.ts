// Реальный движок: камера + MediaPipe PoseLandmarker + правила.
// E-04: камера, поза, цикл по requestAnimationFrame и событие frame с FPS.
// Калибровка, жесты, упражнения и правила подключаются в E-06…E-14; интерфейс уже финальный.

import { openCamera, stopCamera } from './camera';
import { FpsCounter } from './fps';
import { createPoseDetector, type PoseDetector } from './pose';
import type { Engine, EngineEvent, EngineMode, Landmark } from './types';

/** Всё, что трогает браузер, передаётся снаружи: в тестах подменяем на фейки. */
export interface EngineDeps {
  openCamera(video: HTMLVideoElement): Promise<MediaStream>;
  stopCamera(stream: MediaStream | null): void;
  createPoseDetector(): Promise<PoseDetector>;
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
  now(): number;
}

const browserDeps: EngineDeps = {
  openCamera,
  stopCamera,
  createPoseDetector: () => createPoseDetector(),
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};

class RealEngine implements Engine {
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private readonly fps = new FpsCounter();
  private mode: EngineMode = 'calibration';
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private detector: PoseDetector | null = null;
  private frameId: number | null = null;
  private lastVideoTime = -1;
  /** Растёт на каждый start/stop: start, который пережил stop, узнаёт об этом и убирает за собой. */
  private generation = 0;

  constructor(private readonly deps: EngineDeps) {}

  on(cb: (e: EngineEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async start(video: HTMLVideoElement): Promise<void> {
    if (this.detector) return;
    const gen = ++this.generation;

    const stream = await this.deps.openCamera(video);
    if (gen !== this.generation) return this.deps.stopCamera(stream);

    let detector: PoseDetector;
    try {
      detector = await this.deps.createPoseDetector();
    } catch (err) {
      this.deps.stopCamera(stream);
      throw err;
    }
    if (gen !== this.generation) {
      detector.close();
      return this.deps.stopCamera(stream);
    }

    this.video = video;
    this.stream = stream;
    this.detector = detector;
    this.lastVideoTime = -1;
    this.fps.reset();
    this.frameId = this.deps.requestFrame(this.loop);
  }

  stop(): void {
    this.generation++;
    if (this.frameId !== null) this.deps.cancelFrame(this.frameId);
    this.frameId = null;
    this.detector?.close();
    this.detector = null;
    this.deps.stopCamera(this.stream);
    this.stream = null;
    this.video = null;
  }

  setMode(mode: EngineMode): void {
    this.mode = mode;
  }

  /** Текущий режим; пригодится, пока упражнения не подключены. */
  currentMode(): EngineMode {
    return this.mode;
  }

  private readonly loop = (): void => {
    const { video, detector } = this;
    if (!video || !detector) return;
    this.frameId = this.deps.requestFrame(this.loop);

    // rAF тикает чаще камеры: обрабатываем только новый видеокадр.
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    const now = this.deps.now();
    let landmarks: Landmark[] | null;
    try {
      landmarks = detector.detect(video, now);
    } catch (err) {
      // Один битый кадр не должен ронять тренировку.
      console.warn('[engine] кадр пропущен', err);
      return;
    }
    // Пустой массив = в кадре никого: UI стирает скелет. Статус no_person придёт из калибровки (E-06).
    this.emit({ type: 'frame', landmarks: landmarks ?? [], fps: this.fps.tick(now) });
  };

  private emit(e: EngineEvent): void {
    this.listeners.forEach((cb) => cb(e));
  }
}

export function createRealEngine(deps: Partial<EngineDeps> = {}): Engine {
  return new RealEngine({ ...browserDeps, ...deps });
}
