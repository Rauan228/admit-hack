// Реальный движок (E-14): камера → MediaPipe → сглаживание → калибровка / жесты / подход → события.
// Тот же интерфейс, что у мок-движка (E-02): UI переключается флагом ?mock=1 без правок.
//
// Режимы:
// - calibration: полная калибровка; статус шлём при смене и повторяем раз в секунду (как мок);
// - menu: курсор-рука и «обе руки вверх»; калибровка — только «есть ли человек»;
// - упражнение: подход (фазы, подсказки, повторы, итоги); «обе руки вверх» выключено, пока идёт
//   подход с руками над головой; курсор — только после set_complete (на экране итогов).
// Во всех режимах на каждый обработанный кадр — событие frame (UI рисует скелет).

import { createBrightnessMeter } from './brightness';
import { assessCalibration, CalibrationTracker, type CalibrationVerdict } from './calibration';
import { openCamera, stopCamera } from './camera';
import { ENGINE_CONFIG } from './config';
import { createExercise } from './exercises';
import { LandmarkSmoother, smoothPose } from './filter';
import { FpsCounter } from './fps';
import type { PoseFrame } from './geometry';
import { GestureTracker } from './gestures';
import { CALIBRATION_DETAIL_HINTS, CALIBRATION_HINTS } from './hints';
import { AdaptivePerf } from './perf';
import { createPoseDetector, type PoseDetection, type PoseDetector, type PoseDetectorOptions } from './pose';
import { ExerciseSession } from './session';
import type { Engine, EngineEvent, EngineMode } from './types';

/** Всё, что трогает браузер, передаётся снаружи: в тестах подменяем на фейки. */
export interface EngineDeps {
  openCamera(video: HTMLVideoElement): Promise<MediaStream>;
  stopCamera(stream: MediaStream | null): void;
  createPoseDetector(options?: PoseDetectorOptions): Promise<PoseDetector>;
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
  now(): number;
  /** Средняя яркость кадра 0..255 или null (для статуса «темно»). */
  measureBrightness(video: HTMLVideoElement, tMs: number): number | null;
}

function browserDeps(): EngineDeps {
  const brightness = createBrightnessMeter();
  return {
    openCamera,
    stopCamera,
    createPoseDetector: (options) => createPoseDetector(options),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
    measureBrightness: (video, t) => brightness.measure(video, t),
  };
}

const OK: CalibrationVerdict = { status: 'ok', hint: CALIBRATION_HINTS.ok };

class RealEngine implements Engine {
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private readonly fps = new FpsCounter();
  private readonly smoother = new LandmarkSmoother();
  private readonly gestures = new GestureTracker();
  /** Полная калибровка (экран калибровки). */
  private readonly calibration = new CalibrationTracker();
  /** «Есть ли человек» в меню и на подходе; начинаем с ok, чтобы не слать лишнее при входе в режим. */
  private readonly presence = new CalibrationTracker();
  private perf = new AdaptivePerf();
  private mode: EngineMode = 'calibration';
  private session: ExerciseSession | null = null;
  private lastCalibrationAt = -Infinity;
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
    this.smoother.reset();
    this.perf = new AdaptivePerf();
    this.enterMode(this.mode, this.deps.now());
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
    this.session = null;
  }

  setMode(mode: EngineMode): void {
    // Тот же экран ещё раз (например, React перерисовал меню) — ничего не сбрасываем.
    if (typeof mode === 'string' && mode === this.mode) return;
    this.mode = mode;
    // До start() режим просто запоминаем: start сам в него войдёт.
    if (this.detector) this.enterMode(mode, this.deps.now());
  }

  /** Текущий режим (для отладки и dev-стенда). */
  currentMode(): EngineMode {
    return this.mode;
  }

  private enterMode(mode: EngineMode, t: number): void {
    this.gestures.reset();
    this.session = null;
    this.presence.reset();
    this.presence.update(OK, t);
    if (mode === 'calibration') {
      this.calibration.reset();
      this.lastCalibrationAt = -Infinity;
      return;
    }
    if (mode === 'menu') return;
    const def = createExercise(mode.exercise);
    if (!def) {
      console.warn(`[engine] упражнение ${mode.exercise} движок пока не умеет`);
      return;
    }
    this.session = new ExerciseSession(def, Math.max(1, Math.round(mode.targetReps)), t);
    this.emitAll(this.session.begin());
  }

  private readonly loop = (): void => {
    const { video, detector } = this;
    if (!video || !detector) return;
    this.frameId = this.deps.requestFrame(this.loop);

    // rAF тикает чаще камеры: обрабатываем только новый видеокадр.
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    const now = this.deps.now();
    // Слабое устройство: не чаще throttleFps, чтобы главный поток оставался интерфейсу.
    if (!this.perf.shouldProcess(now)) return;
    let detection: PoseDetection | null;
    try {
      detection = detector.detect(video, now);
    } catch (err) {
      // Один битый кадр не должен ронять тренировку.
      console.warn('[engine] кадр пропущен', err);
      return;
    }
    if (this.perf.record(now, this.deps.now() - now) === 'downgrade') this.downgradeModel(detector);
    const aspect =
      video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 4 / 3;
    const frame = detection ? smoothPose(this.smoother, detection.image, detection.world, now, aspect) : null;
    // Пустой массив = в кадре никого: UI стирает скелет.
    this.emit({ type: 'frame', landmarks: frame?.image ?? [], fps: this.fps.tick(now) });
    this.process(frame, video, now);
  };

  /**
   * Медленно даже в среднем — один раз переходим на лёгкую модель, не останавливая камеру:
   * пока новая грузится, работает старая.
   */
  private downgradeModel(current: PoseDetector): void {
    if (current.model === 'lite') return;
    const gen = this.generation;
    this.deps
      .createPoseDetector({ model: 'lite', delegate: current.delegate })
      .then((lite) => {
        if (gen !== this.generation || this.detector !== current) return lite.close();
        this.detector = lite;
        current.close();
        this.perf.resetMeasurements();
        console.info('[engine] медленно — переключился на лёгкую модель');
      })
      .catch((err: unknown) => console.warn('[engine] не удалось переключиться на лёгкую модель', err));
  }

  /** Логика режима на один кадр. */
  private process(frame: PoseFrame | null, video: HTMLVideoElement, t: number): void {
    const mode = this.mode;
    if (mode === 'calibration') {
      const verdict = assessCalibration(frame, this.deps.measureBrightness(video, t));
      const changed = this.calibration.update(verdict, t);
      const current = this.calibration.current;
      if (current && (changed || t - this.lastCalibrationAt >= ENGINE_CONFIG.calibration.repeatMs)) {
        this.lastCalibrationAt = t;
        this.emit({ type: 'calibration', status: current.status, hint: current.hint });
      }
      this.emitAll(this.gestures.update(frame, t, { pointer: false, bothHandsUp: true }));
      return;
    }

    // Яркость меряем всегда (сам замер — раз в 0,5 с): стемнело посреди подхода — скажем «добавь света».
    const brightness = this.deps.measureBrightness(video, t);
    if (mode === 'menu') {
      this.trackPresence(frame ? OK : lost(null, brightness), t);
      this.emitAll(this.gestures.update(frame, t, { pointer: true, bothHandsUp: true }));
      return;
    }

    const session = this.session;
    if (!session) {
      this.emitAll(this.gestures.update(frame, t, { pointer: true, bothHandsUp: true }));
      return;
    }
    const events = session.update(frame, t);
    const cfg = ENGINE_CONFIG.presence;
    const missing = session.unmeasuredFor(t);
    // Человека нет (или не видно нужных суставов) дольше lostMs — пауза и подсказка вернуться.
    this.trackPresence(missing >= cfg.lostMs && !session.done ? lost(frame, brightness) : OK, t);
    if (missing >= cfg.resetAfterMs) events.push(...session.interrupt());
    this.emitAll(events);
    this.emitAll(
      this.gestures.update(frame, t, {
        pointer: session.done,
        bothHandsUp: session.done || !session.def.armsOverhead,
      }),
    );
  }

  private trackPresence(verdict: CalibrationVerdict, t: number): void {
    const changed = this.presence.update(verdict, t);
    if (changed) this.emit({ type: 'calibration', status: changed.status, hint: changed.hint });
  }

  private emit(e: EngineEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(e);
      } catch (err) {
        // Ошибка в одном обработчике UI не должна останавливать движок и остальных подписчиков.
        console.error('[engine] обработчик события упал', err);
      }
    }
  }

  private emitAll(events: readonly EngineEvent[]): void {
    for (const e of events) this.emit(e);
  }
}

/** Вердикт «потеряли человека»: темно, никого в кадре или не видно нужных суставов. */
function lost(frame: PoseFrame | null, brightness: number | null): CalibrationVerdict {
  if (brightness !== null && brightness < ENGINE_CONFIG.calibration.darkLuma) {
    return { status: 'dark', hint: CALIBRATION_HINTS.dark };
  }
  return frame
    ? { status: 'partial', hint: CALIBRATION_DETAIL_HINTS.lostJoints }
    : { status: 'no_person', hint: CALIBRATION_DETAIL_HINTS.lostBody };
}

export function createRealEngine(deps: Partial<EngineDeps> = {}): Engine {
  return new RealEngine({ ...browserDeps(), ...deps });
}
