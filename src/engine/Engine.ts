// Реальный движок (E-14): камера → MediaPipe → сглаживание → калибровка / жесты / подход → события.
// Тот же интерфейс, что у мок-движка (E-02): UI переключается флагом ?mock=1 без правок.
//
// Режимы:
// - calibration: полная калибровка; статус шлём при смене и повторяем раз в секунду (как мок);
// - menu: курсор-рука и «обе руки вверх»; калибровка — только «есть ли человек»;
// - упражнение: подход (фазы, подсказки, повторы, итоги); «обе руки вверх» выключено, пока идёт
//   подход с руками над головой; курсор — только после set_complete (на экране итогов).
// Во всех режимах на каждый обработанный кадр — событие frame (UI рисует скелет).

import { analyzeBar, BAR_H, BAR_W, barRegion, sampleBar, type BarSeen } from './bar';
import { createBrightnessMeter } from './brightness';
import { assessCalibration, CalibrationTracker, type CalibrationVerdict } from './calibration';
import { openCamera, stopCamera } from './camera';
import { ENGINE_CONFIG } from './config';
import { createExercise } from './exercises';
import { LandmarkSmoother, RenderSmoother, smoothPose } from './filter';
import { FpsCounter } from './fps';
import { torsoLength, type PoseFrame } from './geometry';
import { GestureTracker } from './gestures';
import { createHandDetector, handRoi, type HandDetector, type HandSample } from './hands';
import { CALIBRATION_DETAIL_HINTS, CALIBRATION_HINTS } from './hints';
import { AdaptivePerf } from './perf';
import { createPoseDetector, type PoseDetection, type PoseDetector, type PoseDetectorOptions } from './pose';
import { createWorkerPoseDetector, poseWorkerSupported } from './poseWorker';
import { ExerciseSession } from './session';
import { sourceSize } from './snapshot';
import type { Engine, EngineEvent, EngineMode, Side } from './types';

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
  /** Детектор кистей (hands.ts) для упражнений с hands: true; нет — кисти не проверяются. */
  createHandDetector?(): Promise<HandDetector>;
  /**
   * Турник у кистей (подтягивания). По умолчанию — поиск по пикселям видео (bar.ts); в тестах — из записи.
   * undefined — искать негде (кисти не видны, нет доступа к пикселям).
   */
  findBar?(
    video: HTMLVideoElement,
    detection: PoseDetection,
    tMs: number,
    aspect: number,
  ): BarSeen | null | undefined;
}

function browserDeps(): EngineDeps {
  const brightness = createBrightnessMeter();
  return {
    openCamera,
    stopCamera,
    createPoseDetector: async (options) => {
      // Модель в фоновом потоке, если можно; не поднялась — обычный детектор на основном.
      if (ENGINE_CONFIG.pose.worker && poseWorkerSupported()) {
        try {
          return await createWorkerPoseDetector(options);
        } catch (err) {
          console.warn('[engine] модель позы в фоне не запустилась — считаю на основном потоке', err);
        }
      }
      return createPoseDetector(options);
    },
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
    measureBrightness: (video, t) => brightness.measure(video, t),
    createHandDetector: () => createHandDetector(),
  };
}

const OK: CalibrationVerdict = { status: 'ok', hint: CALIBRATION_HINTS.ok };

class RealEngine implements Engine {
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private readonly fps = new FpsCounter();
  private readonly smoother = new LandmarkSmoother();
  /** Скелет на экране: своё сглаживание, без задержки на движении (E-23). */
  private readonly render = new RenderSmoother();
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
  /** Турник (упражнения на перекладине): последний поиск по пикселям и холст для вырезки. */
  private bar: { t: number; seen: BarSeen | null } | null = null;
  private barCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  /** Растёт на каждый start/stop: start, который пережил stop, узнаёт об этом и убирает за собой. */
  private generation = 0;
  /** Кадров в детекторе в фоновом потоке без ответа (не больше pose.workerInFlight). */
  private inFlight = 0;
  /** Кисти (E-36): детектор грузится при входе в упражнение с hands; off — выключен (ошибка или медленно). */
  private hands: HandDetector | null = null;
  private handsLoading = false;
  private handsOff = false;
  private handSamples: Partial<Record<Side, HandSample>> = {};
  /** Среднее время одной проверки кисти, мс, сколько их было и когда была последняя. */
  private handCost = 0;
  private handChecks = 0;
  private lastHandCheckAt = -Infinity;

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
    this.render.reset();
    this.perf = new AdaptivePerf();
    this.enterMode(this.mode, this.deps.now());
    this.frameId = this.deps.requestFrame(this.loop);
  }

  stop(): void {
    this.generation++;
    this.inFlight = 0;
    if (this.frameId !== null) this.deps.cancelFrame(this.frameId);
    this.frameId = null;
    this.detector?.close();
    this.detector = null;
    this.deps.stopCamera(this.stream);
    this.stream = null;
    this.video = null;
    this.session = null;
    this.hands?.close();
    this.hands = null;
    this.handSamples = {};
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
    this.bar = null;
    this.session = new ExerciseSession(def, Math.max(1, Math.round(mode.targetReps)), t);
    this.handSamples = {};
    if (def.hands) this.loadHands();
    this.emitAll(this.session.begin());
  }

  /** Модель кистей — один раз на движок, в фоне; не загрузилась — удары считаются без проверки кулака. */
  private loadHands(): void {
    const create = this.deps.createHandDetector;
    if (!create || !ENGINE_CONFIG.hands.enabled || this.hands || this.handsLoading || this.handsOff) return;
    this.handsLoading = true;
    const gen = this.generation;
    create()
      .then((hands) => {
        if (gen !== this.generation) return hands.close();
        this.hands = hands;
      })
      .catch((err: unknown) => {
        this.handsOff = true;
        console.warn('[engine] кисти не проверяем — модель не загрузилась', err);
      })
      .finally(() => {
        this.handsLoading = false;
      });
  }

  /**
   * Кисти бьющей стороны проверяем только на подлёте удара (фазы down и bottom): в стойке и на возврате
   * модель кисти не нужна. Результат — в кадр, измеритель решает, что с ним делать (бокс: ладонь — удар не засчитан).
   */
  private checkHands(frame: PoseFrame, session: ExerciseSession, video: HTMLVideoElement): void {
    const cfg = ENGINE_CONFIG.hands;
    if (
      this.hands &&
      !session.done &&
      (session.phase === 'down' || session.phase === 'bottom') &&
      frame.t - this.lastHandCheckAt >= cfg.minIntervalMs
    ) {
      this.lastHandCheckAt = frame.t;
      const source = this.detector?.frame ?? video;
      const { w, h } = sourceSize(source);
      // Бьющую кисть называет измеритель; не назвал — проверяем обе.
      const wanted = session.lastMetrics?.hand;
      for (const side of wanted ? [wanted] : (['left', 'right'] as const)) {
        const roi = handRoi(frame, side, w, h);
        if (!roi) continue;
        const t0 = this.deps.now();
        let state: HandSample['state'] = 'unknown';
        try {
          state = this.hands.detect(source, roi);
        } catch (err) {
          console.warn('[engine] проверка кисти не удалась', err);
        }
        const prev = this.handSamples[side];
        this.handSamples[side] = { state, t: frame.t, streak: prev?.state === state ? prev.streak + 1 : 1 };
        const cost = this.deps.now() - t0;
        // Журнал для стенда (dev/engine.html): какую кисть и что увидели, сколько стоило.
        (
          globalThis as { __handsLog?: { t: number; side: Side; state: string; cost: number }[] }
        ).__handsLog?.push({
          t: frame.t,
          side,
          state,
          cost,
        });
        this.handChecks += 1;
        // Первый вызов — прогрев (шейдеры), в среднее не берём.
        if (this.handChecks > 1) this.handCost += (cost - this.handCost) / Math.min(this.handChecks - 1, 20);
        if (this.handChecks >= 7 && this.handCost > cfg.budgetMs) {
          console.info(
            `[engine] кисти слишком медленно (${this.handCost.toFixed(0)} мс) — выключил проверку кулака`,
          );
          this.handsOff = true;
          this.hands.close();
          this.hands = null;
          break;
        }
      }
    }
    frame.hands = { ...this.handSamples };
  }

  private readonly loop = (): void => {
    const { video, detector } = this;
    if (!video || !detector) return;
    this.frameId = this.deps.requestFrame(this.loop);

    // rAF тикает чаще камеры: обрабатываем только новый видеокадр.
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    const now = this.deps.now();
    // Детектор в фоновом потоке: кадр за раз, точки обрабатываем, когда придут.
    if (detector.detectAsync) {
      if (this.inFlight >= (detector.inFlightLimit ?? 1)) return;
      this.inFlight += 1;
      const gen = this.generation;
      detector
        .detectAsync(video, now)
        .then((detection) => {
          if (gen !== this.generation || this.detector !== detector) return;
          this.afterDetect(detection, detector, video, now, detector.lastCostMs ?? this.deps.now() - now);
        })
        .catch((err: unknown) => console.warn('[engine] кадр пропущен', err))
        .finally(() => {
          if (gen === this.generation) this.inFlight = Math.max(0, this.inFlight - 1);
        });
      return;
    }
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
    this.afterDetect(detection, detector, video, now, this.deps.now() - now);
  };

  /** Точки кадра пришли: сглаживание, событие frame для экрана, логика режима. */
  private afterDetect(
    detection: PoseDetection | null,
    detector: PoseDetector,
    video: HTMLVideoElement,
    now: number,
    costMs: number,
  ): void {
    if (this.perf.record(now, costMs) === 'downgrade') this.downgradeModel(detector);
    const aspect =
      video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 4 / 3;
    const frame = detection ? smoothPose(this.smoother, detection.image, detection.world, now, aspect) : null;
    if (frame && detection && this.session?.def.needsBar)
      frame.bar = (this.deps.findBar ?? this.findBar.bind(this))(video, detection, now, aspect);
    // Пустой массив = в кадре никого: UI стирает скелет. image — кадр, на котором модель считала точки.
    const image = detector.frame;
    const scale = detection
      ? torsoLength({ t: now, aspect, image: detection.image, world: null }) || 0.25
      : 0;
    this.emit({
      type: 'frame',
      landmarks:
        detection && frame ? this.render.apply(detection.image, frame.image, now, aspect, scale) : [],
      fps: this.fps.tick(now),
      ...(image ? { image } : {}),
    });
    this.process(frame, video, now);
  }

  /**
   * Перекладина у кистей по пикселям кадра — не чаще раза в barEveryMs (поиск ~1–2 мс), между поисками —
   * последний результат. undefined — кисти не видны и искать негде.
   */
  private findBar(
    video: HTMLVideoElement,
    detection: PoseDetection,
    now: number,
    aspect: number,
  ): BarSeen | null | undefined {
    const every = ENGINE_CONFIG.exercises.pull_up.barEveryMs;
    if (this.bar && now - this.bar.t < every) return this.bar.seen;
    const region = barRegion(detection.image, aspect);
    if (!region || !video.videoWidth)
      return this.bar && now - this.bar.t < 4 * every ? this.bar.seen : undefined;
    try {
      this.barCtx ??=
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(BAR_W, BAR_H).getContext('2d', { willReadFrequently: true })
          : Object.assign(document.createElement('canvas'), { width: BAR_W, height: BAR_H }).getContext(
              '2d',
              {
                willReadFrequently: true,
              },
            );
      if (!this.barCtx) return undefined;
      const gray = sampleBar(video, video.videoWidth, video.videoHeight, region, this.barCtx);
      this.bar = { t: now, seen: analyzeBar(gray, region) };
      return this.bar.seen;
    } catch (err) {
      // Без доступа к пикселям турник не ищем — счёт по движению тела остаётся.
      console.warn('[engine] поиск турника недоступен', err);
      return undefined;
    }
  }

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
    if (frame && session.def.hands) this.checkHands(frame, session, video);
    const events = session.update(frame, t);
    const cfg = ENGINE_CONFIG.presence;
    const missing = session.unmeasuredFor(t);
    // Человека нет (или не видно нужных суставов) дольше lostMs — пауза и подсказка вернуться.
    this.trackPresence(
      missing >= cfg.lostMs && !session.done ? lost(frame, brightness, session.def.lostHint) : OK,
      t,
    );
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
function lost(frame: PoseFrame | null, brightness: number | null, jointsHint?: string): CalibrationVerdict {
  if (brightness !== null && brightness < ENGINE_CONFIG.calibration.darkLuma) {
    return { status: 'dark', hint: CALIBRATION_HINTS.dark };
  }
  return frame
    ? { status: 'partial', hint: jointsHint ?? CALIBRATION_DETAIL_HINTS.lostJoints }
    : { status: 'no_person', hint: CALIBRATION_DETAIL_HINTS.lostBody };
}

export function createRealEngine(deps: Partial<EngineDeps> = {}): Engine {
  return new RealEngine({ ...browserDeps(), ...deps });
}
