// Мок-движок (E-02): реализует тот же интерфейс Engine, что и реальный, но без камеры.
// По таймеру шлёт реалистичную последовательность всех событий контракта,
// чтобы UI (задачи U-xx) собирался и отлаживался до готовности распознавания.

import { CALIBRATION_HINTS, formErrorsFor, type FormErrorDef } from '../engine/hints';
import type {
  CalibrationStatus,
  Engine,
  EngineEvent,
  EngineMode,
  ExerciseId,
  SetStats,
} from '../engine/types';
import { BOTH_HANDS_UP, body, buildPose, easeInOut, lerpBody, pointingBody, type BodyParams } from './poses';

export interface MockEngineOptions {
  /** Сколько событий frame в секунду (по умолчанию 30). */
  fps?: number;
  /** Ускорение сценария: 2 — вдвое быстрее. */
  speed?: number;
  /** Играть полный сценарий сам, если UI не вызвал setMode (по умолчанию да). */
  autoRun?: boolean;
  /** Сид для псевдослучайных чисел: с ним прогон воспроизводим. */
  seed?: number;
}

/** Уровень пола стоя (для прыжка и подъёма на носки). */
const STANDING_GROUND = body().groundY;

/** Длительность одного повторения в моке, мс. */
const REP_MS = 2400;
/** Сколько повторений играет автосценарий. */
const STORY_REPS = 5;
const STORY_ORDER: ExerciseId[] = ['squat', 'jumping_jack', 'lunge', 'arm_raise'];

const CALIBRATION_BODIES: Record<CalibrationStatus, BodyParams> = {
  no_person: body({ visibility: 0.1, legVisibility: 0.1, height: 0.5, groundY: 1.3 }),
  partial: body({ height: 1.15, groundY: 1.22, legVisibility: 0.25 }),
  too_close: body({ height: 1.05, groundY: 1.08, legVisibility: 0.6 }),
  too_far: body({ height: 0.45, groundY: 0.72, centerX: 0.62 }),
  dark: body({ visibility: 0.45, legVisibility: 0.4 }),
  ok: body(),
};

/** Сценарий калибровки: сначала «видно не целиком» и «слишком близко», потом ok. */
const CALIBRATION_SCRIPT: { at: number; status: CalibrationStatus }[] = [
  { at: 200, status: 'partial' },
  { at: 1800, status: 'too_close' },
  { at: 3400, status: 'ok' },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Какую ошибку демонстрируем на повторении с индексом i (null — чистое повторение). */
export function plannedError(exercise: ExerciseId, i: number): FormErrorDef | null {
  if (i % 3 === 0) return null;
  const catalog = formErrorsFor(exercise);
  const k = i - 1 - Math.floor(i / 3);
  return catalog[k % catalog.length] ?? null;
}

/** Поза упражнения в момент цикла 0..1 (0 — исходное положение, 0.5 — нижняя точка). */
export function exercisePose(
  exercise: ExerciseId,
  cycle: number,
  err: FormErrorDef | null,
  /** Номер повтора: упражнения со сменой сторон чередуют ногу. */
  rep = 0,
): BodyParams {
  const wave = easeInOut(cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2);
  const code = err?.code;
  switch (exercise) {
    case 'squat': {
      const depth = code === 'shallow_depth' ? wave * 0.45 : wave;
      return body({
        squat: depth,
        kneeIn: code === 'knees_in' ? wave : 0,
        lean: code === 'torso_lean' ? wave * 42 : wave * 10,
        stance: code === 'asymmetry' ? 0.22 + wave * 0.1 : 0.22,
        armL: 60 + wave * 25,
        armR: 60 + wave * 25,
        elbowL: 40,
        elbowR: 40,
      });
    }
    case 'jumping_jack': {
      const armWave = code === 'not_synced' ? easeInOut(Math.max(0, cycle * 2 - 0.55)) : wave;
      const armTop = code === 'arms_low' ? 95 : 168;
      const stanceTop = code === 'feet_narrow' ? 0.26 : 0.58;
      return body({
        armL: 12 + armWave * (armTop - 12),
        armR: 12 + armWave * (armTop - 12),
        elbowL: 6,
        elbowR: 6,
        stance: 0.2 + wave * (stanceTop - 0.2),
        squat: wave * 0.08,
      });
    }
    case 'lunge': {
      const depth = code === 'back_knee_high' ? wave * 0.4 : wave * 0.85;
      return body({
        lungeFront: wave * (code === 'knee_past_toe' ? 0.62 : 0.45),
        squat: depth,
        lean: code === 'torso_lean' ? wave * 35 : wave * 6,
        kneeIn: code === 'knee_past_toe' ? wave * 0.5 : 0,
        armL: 55,
        armR: 55,
        elbowL: 55,
        elbowR: 55,
      });
    }
    case 'arm_raise': {
      const top = 172;
      const bent = code === 'elbows_bent' ? 45 : 6;
      const rightTop = code === 'one_arm_low' ? 92 : top;
      return body({
        armL: 12 + wave * (top - 12),
        armR: 12 + wave * (rightTop - 12),
        elbowL: bent,
        elbowR: bent,
      });
    }
    case 'high_knees': {
      // Каждый повтор — одно колено: чётные — левое, нечётные — правое; руки согнуты, как в беге.
      const lift = wave * (code === 'knees_low' ? 0.45 : 1);
      return body({
        ...(rep % 2 === 0 ? { kneeLiftL: lift } : { kneeLiftR: lift }),
        lean: code === 'lean_back' ? -14 * wave : 0,
        armL: 20,
        armR: 20,
        elbowL: 95,
        elbowR: 95,
      });
    }
    case 'knee_to_elbow': {
      // Руки за головой; чётные повторы — правое колено и левый локоть, нечётные — наоборот.
      const lift = wave * (code === 'knee_low' ? 0.3 : 0.9);
      const reach = wave * (code === 'elbow_far' ? 35 : 95);
      const rightKnee = rep % 2 === 0;
      return body({
        ...(rightKnee ? { kneeLiftR: lift } : { kneeLiftL: lift }),
        lean: 12 * wave,
        armL: 150 - (rightKnee ? reach : 0),
        armR: 150 - (rightKnee ? 0 : reach),
        elbowL: 150,
        elbowR: 150,
      });
    }
    case 'squat_press': {
      // Первая половина цикла — присед (кисти у плеч), вторая — встал и выжал руки вверх.
      const depth = cycle < 0.5 ? easeInOut(cycle < 0.25 ? cycle * 4 : (0.5 - cycle) * 4) : 0;
      const press =
        cycle >= 0.45 ? easeInOut(cycle < 0.725 ? (cycle - 0.45) / 0.275 : (1 - cycle) / 0.275) : 0;
      const armTop = code === 'press_low' ? 115 : 175;
      return body({
        squat: depth * (code === 'shallow_depth' ? 0.45 : 1),
        kneeIn: code === 'knees_in' ? depth : 0,
        lean: depth * 10,
        armL: 25 + press * (armTop - 25),
        armR: 25 + press * (armTop - 25),
        elbowL: 150 - press * (code === 'press_low' ? 90 : 145),
        elbowR: 150 - press * (code === 'press_low' ? 90 : 145),
      });
    }
    case 'side_bend': {
      // Чётные повторы — наклон влево, нечётные — вправо.
      const tilt = wave * (code === 'shallow_bend' ? 12 : 30) * (rep % 2 === 0 ? 1 : -1);
      return body({
        sideTilt: tilt,
        lean: code === 'lean_forward' ? wave * 30 : 0,
        centerX: 0.5 + (code === 'hips_shift' ? tilt / 300 : 0),
        armL: 25,
        armR: 25,
        elbowL: 110,
        elbowR: 110,
      });
    }
    case 'side_leg_raise': {
      const out = wave * (code === 'leg_low' ? 0.45 : 1);
      return body({
        ...(rep % 2 === 0 ? { legOutL: out } : { legOutR: out }),
        sideTilt: code === 'torso_tilt' ? wave * 20 * (rep % 2 === 0 ? -1 : 1) : 0,
        armL: 25,
        armR: 25,
        elbowL: 110,
        elbowR: 110,
      });
    }
    case 'side_lunge': {
      // Широкая стойка, таз уходит к согнутой ноге и вниз.
      const depth = wave * (code === 'shallow_side' ? 0.45 : 0.9);
      return body({
        stance: 0.5,
        squat: depth,
        centerX: 0.5 + (rep % 2 === 0 ? 1 : -1) * 0.07 * depth,
        kneeIn: code === 'knee_in' ? depth : 0,
        lean: code === 'torso_lean' ? wave * 40 : wave * 8,
        armL: 30,
        armR: 30,
        elbowL: 120,
        elbowR: 120,
      });
    }
    case 'jump_squat': {
      const depth = cycle < 0.5 ? easeInOut(cycle < 0.25 ? cycle * 4 : (0.5 - cycle) * 4) : 0;
      const air =
        code === 'no_jump' ? 0 : cycle >= 0.5 && cycle < 0.8 ? Math.sin((Math.PI * (cycle - 0.5)) / 0.3) : 0;
      return body({
        squat: depth * (code === 'shallow_depth' ? 0.45 : 1),
        kneeIn: code === 'knees_in' ? depth : 0,
        groundY: STANDING_GROUND - 0.07 * air,
        armL: 20 + depth * 40 + air * 120,
        armR: 20 + depth * 40 + air * 120,
      });
    }
    case 'calf_raise':
      return body({ groundY: STANDING_GROUND - wave * (code === 'low_raise' ? 0.012 : 0.03) });
    case 'cross_jack': {
      const open = code === 'no_cross' ? 0.35 + wave * 0.65 : wave;
      return body({
        armL: code === 'arms_low' ? 20 + open * 35 : 20 + open * 70,
        armR: code === 'arms_low' ? 20 + open * 35 : 20 + open * 70,
        elbowL: (1 - open) * 140,
        elbowR: (1 - open) * 140,
        stance: 0.08 + open * (code === 'feet_narrow' ? 0.14 : 0.5),
      });
    }
    case 'arm_circles': {
      // Руки в стороны, кисти поднимаются и опускаются по кругу.
      const a = 2 * Math.PI * cycle;
      const r = code === 'small_circles' ? 5 : 16;
      const arm = code === 'arms_low' ? 45 : 90;
      return body({
        armL: arm + r * Math.cos(a),
        armR: arm + r * Math.cos(a),
        elbowL: code === 'elbows_bent' ? 60 : 4,
        elbowR: code === 'elbows_bent' ? 60 : 4,
      });
    }
    case 'boxing': {
      // Защита: кулаки у подбородка; удар — рука распрямляется (чётные — левой, нечётные — правой).
      const hit = wave * (code === 'short_punch' ? 0.5 : 1);
      const left = rep % 2 === 0;
      const guardDrop = code === 'guard_down' ? wave : 0;
      return body({
        armL: left ? 30 + hit * 55 : 30 - guardDrop * 20,
        armR: left ? 30 - guardDrop * 20 : 30 + hit * 55,
        elbowL: left ? 150 - hit * 145 : 150 - guardDrop * 120,
        elbowR: left ? 150 - guardDrop * 120 : 150 - hit * 145,
      });
    }
    case 'push_up':
      return body({
        lying: 0.82 + wave * (code === 'shallow_pushup' ? 0.05 : 0.14),
        armL: 175,
        armR: 175,
        squat: code === 'hips_sag' ? 0.2 : 0,
      });
    case 'plank':
      return body({
        lying: 0.9,
        armL: 175,
        armR: 175,
        elbowL: 90,
        elbowR: 90,
        squat: code === 'hips_sag' ? 0.2 : 0,
      });
    case 'burpee': {
      // Вниз → упор лёжа → обратно → прыжок.
      const down = easeInOut(Math.min(1, Math.max(0, cycle < 0.5 ? cycle * 3 : (0.85 - cycle) * 3)));
      const air = code === 'no_jump' ? 0 : cycle > 0.85 ? Math.sin((Math.PI * (cycle - 0.85)) / 0.15) : 0;
      return body({
        squat: Math.min(1, down * 2),
        lying: Math.max(0, down * 2 - 1) * (code === 'not_low' ? 0.3 : 0.9),
        groundY: STANDING_GROUND - 0.05 * air,
        armL: 12 + air * 160,
        armR: 12 + air * 160,
      });
    }
  }
}

class MockEngine implements Engine {
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private readonly fps: number;
  private readonly frameMs: number;
  private readonly speed: number;
  private readonly autoRun: boolean;
  private readonly rng: () => number;

  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private sceneTimers: ReturnType<typeof setTimeout>[] = [];
  private storyTimers: ReturnType<typeof setTimeout>[] = [];
  private running = false;
  /** Внутренние часы: считаем кадрами, поэтому прогон детерминирован в тестах. */
  private clock = 0;
  private sceneStart = 0;
  private target: BodyParams = body();
  private current: BodyParams = body();
  private poseAt: (t: number) => BodyParams = () => body();
  private modeFromUi = false;
  private pendingMode: EngineMode | null = null;
  private storyIndex = 0;

  constructor(options: MockEngineOptions = {}) {
    this.fps = options.fps ?? 30;
    this.frameMs = Math.round(1000 / this.fps);
    this.speed = options.speed ?? 1;
    this.autoRun = options.autoRun ?? true;
    this.rng = mulberry32(options.seed ?? 20260930);
  }

  on(cb: (e: EngineEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async start(_video: HTMLVideoElement): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.clock = 0;
    this.sceneStart = 0;
    this.frameTimer = setInterval(() => this.tick(), this.frameMs);
    if (this.pendingMode) {
      const mode = this.pendingMode;
      this.pendingMode = null;
      this.setMode(mode);
    } else if (this.autoRun) {
      // Даём UI шанс задать режим сам; если не задал — играем полный сценарий.
      this.storyAt(150, () => this.playStory());
    }
  }

  stop(): void {
    this.running = false;
    if (this.frameTimer !== null) clearInterval(this.frameTimer);
    this.frameTimer = null;
    this.clearScene();
    this.clearStory();
  }

  setMode(mode: EngineMode): void {
    if (!this.running) {
      this.pendingMode = mode;
      return;
    }
    this.modeFromUi = true;
    this.clearStory();
    if (mode === 'calibration') this.enterCalibration();
    else if (mode === 'menu') this.enterMenu();
    else this.enterExercise(mode.exercise, mode.targetReps);
  }

  // ——— внутреннее ———

  private emit(e: EngineEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  private tick(): void {
    this.clock += this.frameMs;
    const t = (this.clock - this.sceneStart) * this.speed;
    this.target = this.poseAt(t);
    this.current = lerpBody(this.current, this.target, 0.3);
    this.emit({
      type: 'frame',
      landmarks: buildPose(this.current),
      fps: Math.round(this.fps + (this.rng() - 0.5) * 3),
    });
  }

  /** Отложенный шаг сцены: время масштабируется опцией speed. */
  private at(ms: number, fn: () => void): void {
    this.sceneTimers.push(setTimeout(fn, ms / this.speed));
  }

  private storyAt(ms: number, fn: () => void): void {
    this.storyTimers.push(setTimeout(fn, ms / this.speed));
  }

  private clearScene(): void {
    for (const id of this.sceneTimers) clearTimeout(id);
    this.sceneTimers = [];
  }

  private clearStory(): void {
    for (const id of this.storyTimers) clearTimeout(id);
    this.storyTimers = [];
  }

  private newScene(poseAt: (t: number) => BodyParams): void {
    this.clearScene();
    this.sceneStart = this.clock;
    this.poseAt = poseAt;
  }

  private enterCalibration(): void {
    let status: CalibrationStatus = 'no_person';
    this.newScene(() => CALIBRATION_BODIES[status]);
    for (const step of CALIBRATION_SCRIPT) {
      this.at(step.at, () => {
        status = step.status;
        this.emit({ type: 'calibration', status, hint: CALIBRATION_HINTS[status] });
      });
    }
    // Реальный движок шлёт статус постоянно — мок повторяет его раз в секунду.
    this.sceneTimers.push(
      setInterval(() => {
        if (status !== 'no_person') {
          this.emit({ type: 'calibration', status, hint: CALIBRATION_HINTS[status] });
        }
      }, 1000 / this.speed) as unknown as ReturnType<typeof setTimeout>,
    );
  }

  private enterMenu(): void {
    const LOST_FROM = 5000;
    const LOST_TO = 6200;
    const GESTURE_AT = 8600;
    const LOOP_AT = 10600;
    const path = (t: number) => ({
      x: 0.5 + 0.28 * Math.sin(t / 1500),
      y: 0.46 + 0.2 * Math.sin(t / 900 + 1),
      hand: (t < LOST_FROM ? 'right' : 'left') as 'left' | 'right',
    });
    this.newScene((t) => {
      if (t >= GESTURE_AT && t < GESTURE_AT + 1400) return BOTH_HANDS_UP;
      if (t >= LOST_FROM && t < LOST_TO) return body();
      const p = path(t);
      return pointingBody(p.x, p.y, p.hand);
    });

    let frame = 0;
    this.sceneTimers.push(
      setInterval(() => {
        frame += 1;
        if (frame % 2 !== 0) return; // курсор шлём ~15 раз в секунду
        const t = (this.clock - this.sceneStart) * this.speed;
        if (t >= GESTURE_AT || (t >= LOST_FROM && t < LOST_TO)) return;
        const p = path(t);
        this.emit({ type: 'pointer', x: round3(p.x), y: round3(p.y), hand: p.hand });
      }, this.frameMs) as unknown as ReturnType<typeof setTimeout>,
    );
    this.at(LOST_FROM, () => this.emit({ type: 'pointer_lost' }));
    this.at(GESTURE_AT, () => {
      this.emit({ type: 'pointer_lost' });
      this.emit({ type: 'gesture', name: 'both_hands_up' });
    });
    this.at(LOOP_AT, () => this.enterMenu());
  }

  private enterExercise(exercise: ExerciseId, targetReps: number): void {
    const reps = Math.max(1, Math.round(targetReps));
    const perRep: number[] = [];
    const errorCounts: Record<string, number> = {};
    const errFor = (i: number) => plannedError(exercise, i);

    this.newScene((t) => {
      const i = Math.min(reps - 1, Math.floor(t / REP_MS));
      const cycle = (t % REP_MS) / REP_MS;
      return exercisePose(exercise, cycle, errFor(i), i);
    });

    for (let i = 0; i < reps; i += 1) {
      const base = i * REP_MS;
      const err = errFor(i);
      this.at(base, () => this.emit({ type: 'phase', exercise, phase: 'start' }));
      this.at(base + 250, () => this.emit({ type: 'phase', exercise, phase: 'down' }));
      this.at(base + 1000, () => this.emit({ type: 'phase', exercise, phase: 'bottom' }));
      this.at(base + 1650, () => this.emit({ type: 'phase', exercise, phase: 'up' }));
      if (err) {
        // Подсказку показываем на той фазе, к которой привязано правило (PLAN §3).
        const phaseAt = err.phases.includes('bottom') ? 1050 : err.phases.includes('down') ? 700 : 1700;
        this.at(base + phaseAt, () =>
          this.emit({
            type: 'form_error',
            exercise,
            code: err.code,
            message: err.message,
            joints: err.joints,
            ...(err.arrow ? { arrow: err.arrow } : {}),
            severity: err.severity,
          }),
        );
      }
      if (exercise === 'lunge') {
        // Выпады считаются парой ног: правая половина посередине цикла, левая — вместе с повтором.
        this.at(base + 1300, () =>
          this.emit({ type: 'half_rep', exercise, side: 'right', errors: err ? [err.code] : [] }),
        );
        this.at(base + 2040, () => this.emit({ type: 'half_rep', exercise, side: 'left', errors: [] }));
      }
      this.at(base + 2050, () => {
        const score = err
          ? Math.max(20, Math.round(100 - err.penalty - this.rng() * 8))
          : Math.round(94 + this.rng() * 6);
        perRep.push(score);
        if (err) errorCounts[err.code] = (errorCounts[err.code] ?? 0) + 1;
        else this.emit({ type: 'form_ok', exercise });
        this.emit({
          type: 'rep',
          exercise,
          count: i + 1,
          score,
          errors: err ? [err.code] : [],
        });
      });
    }

    this.at(reps * REP_MS + 400, () => {
      const stats: SetStats = {
        reps: perRep.length,
        cleanReps: perRep.filter((_, i) => errFor(i) === null).length,
        avgScore: Math.round(perRep.reduce((a, b) => a + b, 0) / Math.max(1, perRep.length)),
        durationSec: Math.round((reps * REP_MS) / 100) / 10,
        errorCounts,
        perRep: [...perRep],
      };
      this.emit({ type: 'set_complete', exercise, stats });
      if (!this.modeFromUi) this.continueStory();
    });
  }

  private playStory(): void {
    this.enterCalibration();
    this.storyAt(5200, () => this.enterMenu());
    this.storyAt(14000, () => this.enterExercise(STORY_ORDER[this.storyIndex] ?? 'squat', STORY_REPS));
  }

  /** После итогов сета автосценарий идёт в меню и берёт следующее упражнение. */
  private continueStory(): void {
    this.storyIndex = (this.storyIndex + 1) % STORY_ORDER.length;
    this.storyAt(2500, () => this.enterMenu());
    this.storyAt(11000, () => this.enterExercise(STORY_ORDER[this.storyIndex] ?? 'squat', STORY_REPS));
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Фабрика мок-движка. Реальный движок появится в E-14 с тем же интерфейсом. */
export function createMockEngine(options: MockEngineOptions = {}): Engine {
  return new MockEngine(options);
}
