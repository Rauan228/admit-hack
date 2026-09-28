import { createRealEngine, type EngineDeps } from '../src/engine/Engine';
import type { PoseFrame } from '../src/engine/geometry';
import type { PoseDetection, PoseDetector } from '../src/engine/pose';
import type { EngineEvent, EngineMode, Landmark } from '../src/engine/types';
import { BOTH_HANDS_UP, body, buildPose } from '../src/mocks/poses';
import { gaussian, jackFrames, squatPose, squatTrack, synthFrame } from './helpers/synth';

const POSE: Landmark[] = Array.from({ length: 33 }, (_, i) => ({ x: i / 33, y: 0.5, z: 0, v: 1 }));

/**
 * Фейковый браузер: кадры крутим вручную через flush(), время задаём сами.
 * detect получает текущее время — так сценарий «человека» можно описать функцией от времени.
 */
function fakeWorld(detect: (tMs: number) => PoseDetection | null = () => ({ image: POSE, world: null })) {
  let queued: (() => void) | null = null;
  let clock = 0;
  const video = { readyState: 4, currentTime: 0, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement & {
    currentTime: number;
  };
  const stream = { stopped: false } as unknown as MediaStream & { stopped: boolean };
  const detector = {
    delegate: 'CPU',
    model: 'lite',
    detect: vi.fn((_v: unknown, t: number) => detect(t)),
    close: vi.fn(),
  };

  const deps: EngineDeps = {
    openCamera: vi.fn(async () => stream),
    stopCamera: vi.fn((s) => {
      if (s) (s as typeof stream).stopped = true;
    }),
    createPoseDetector: vi.fn(async () => detector as unknown as PoseDetector),
    requestFrame: (cb) => {
      queued = cb;
      return 1;
    },
    cancelFrame: () => {
      queued = null;
    },
    now: () => clock,
    measureBrightness: () => 120,
  };

  /** Новый видеокадр через step мс и один тик rAF. */
  const flush = (newVideoFrame = true, step = 1000 / 30) => {
    clock += step;
    if (newVideoFrame) video.currentTime += step / 1000;
    const cb = queued;
    queued = null;
    cb?.();
  };
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 1000 / 30) flush();
  };
  return { deps, video, stream, detector, flush, run };
}

/** Сценарий из списка кадров с временами (берём последний кадр не позже t). */
function script(frames: PoseFrame[]): (t: number) => PoseDetection | null {
  return (t) => {
    let best: PoseFrame | null = null;
    for (const f of frames) if (f.t <= t) best = f;
    return best ? { image: best.image, world: best.world } : null;
  };
}

async function started(world: ReturnType<typeof fakeWorld>, mode?: EngineMode) {
  const engine = createRealEngine(world.deps);
  const events: EngineEvent[] = [];
  engine.on((e) => events.push(e));
  if (mode) engine.setMode(mode);
  await engine.start(world.video);
  return { engine, events };
}

const ofType = <T extends EngineEvent['type']>(events: EngineEvent[], type: T) =>
  events.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);

describe('реальный движок: камера и цикл (E-04)', () => {
  it('после start шлёт frame с 33 точками и FPS', async () => {
    const w = fakeWorld();
    const { engine, events } = await started(w);
    for (let i = 0; i < 40; i++) w.flush();
    const frames = ofType(events, 'frame');
    expect(frames).toHaveLength(40);
    expect(frames[0]?.landmarks).toHaveLength(33);
    expect(frames.at(-1)?.fps).toBe(30);
    engine.stop();
  });

  it('обрабатывает только новые видеокадры, а не каждый тик rAF', async () => {
    const w = fakeWorld();
    const { engine } = await started(w);
    w.flush(true);
    w.flush(false);
    w.flush(false);
    w.flush(true);
    expect(w.detector.detect).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it('никого в кадре → frame с пустым массивом, чтобы UI стёр скелет', async () => {
    const w = fakeWorld(() => null);
    const { engine, events } = await started(w);
    w.flush();
    expect(ofType(events, 'frame')[0]).toMatchObject({ landmarks: [] });
    engine.stop();
  });

  it('битый кадр пропускается, цикл продолжается', async () => {
    let calls = 0;
    const w = fakeWorld(() => {
      calls++;
      if (calls === 1) throw new Error('GPU hiccup');
      return { image: POSE, world: null };
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { engine, events } = await started(w);
    w.flush();
    w.flush();
    warn.mockRestore();
    expect(ofType(events, 'frame')).toHaveLength(1);
    engine.stop();
  });

  it('stop гасит камеру, закрывает модель и останавливает цикл', async () => {
    const w = fakeWorld();
    const { engine, events } = await started(w);
    engine.stop();
    w.flush();
    expect(events).toHaveLength(0);
    expect(w.stream.stopped).toBe(true);
    expect(w.detector.close).toHaveBeenCalled();
  });

  it('stop во время загрузки модели не оставляет камеру включённой', async () => {
    const w = fakeWorld();
    let release!: () => void;
    w.deps.createPoseDetector = () =>
      new Promise((resolve) => {
        release = () => resolve(w.detector as unknown as PoseDetector);
      });
    const engine = createRealEngine(w.deps);
    const starting = engine.start(w.video);
    await Promise.resolve();
    await Promise.resolve();
    engine.stop();
    release();
    await starting;
    expect(w.stream.stopped).toBe(true);
    expect(w.detector.close).toHaveBeenCalled();
  });

  it('если модель не загрузилась, камера выключается, а ошибка доходит до UI', async () => {
    const w = fakeWorld();
    w.deps.createPoseDetector = async () => {
      throw new Error('CDN недоступен');
    };
    const engine = createRealEngine(w.deps);
    await expect(engine.start(w.video)).rejects.toThrow('CDN недоступен');
    expect(w.stream.stopped).toBe(true);
  });
});

describe('реальный движок: режимы и протокол событий как у мока (E-14)', () => {
  const standing = (): PoseDetection => ({ image: buildPose(body()), world: null });

  it('калибровка: статус ok приходит сразу и повторяется раз в секунду', async () => {
    const w = fakeWorld(standing);
    const { engine, events } = await started(w, 'calibration');
    w.run(2500);
    const calib = ofType(events, 'calibration');
    expect(calib[0]).toMatchObject({ status: 'ok' });
    expect(calib.length).toBeGreaterThanOrEqual(3);
    expect(calib.every((e) => e.status === 'ok')).toBe(true);
    engine.stop();
  });

  it('калибровка: никого в кадре → no_person, человек пришёл → ok', async () => {
    let present = false;
    const w = fakeWorld(() => (present ? standing() : null));
    const { engine, events } = await started(w, 'calibration');
    w.run(1200);
    present = true;
    w.run(1500);
    const statuses = ofType(events, 'calibration').map((e) => e.status);
    expect(statuses[0]).toBe('no_person');
    expect(statuses.at(-1)).toBe('ok');
    engine.stop();
  });

  it('меню: поднятая рука ведёт курсор, опущенная — pointer_lost, обе вверх — жест', async () => {
    let pose = body();
    const w = fakeWorld(() => ({ image: buildPose(pose), world: null }));
    const { engine, events } = await started(w, 'menu');
    w.run(500);
    pose = body({ armR: 100, elbowR: 0 });
    w.run(1000);
    pose = body();
    w.run(500);
    pose = BOTH_HANDS_UP;
    w.run(1500);
    expect(ofType(events, 'pointer').length).toBeGreaterThan(20);
    expect(ofType(events, 'pointer_lost').length).toBeGreaterThanOrEqual(1);
    expect(ofType(events, 'gesture')).toEqual([{ type: 'gesture', name: 'both_hands_up' }]);
    // В меню человек на месте — калибровка молчит (без лишних «ok»).
    expect(ofType(events, 'calibration')).toEqual([]);
    engine.stop();
  });

  it('подход приседаний: start, фазы, повторы с оценкой, set_complete на целевом числе', async () => {
    const noise = gaussian(0.002, 5);
    const frames = squatTrack({ reps: 4, depth: 100 }).map(({ t, thigh }) =>
      synthFrame(squatPose(thigh), t, noise),
    );
    const w = fakeWorld(script(frames));
    const { engine, events } = await started(w, { exercise: 'squat', targetReps: 3 });
    w.run(frames.at(-1)!.t + 500);
    const types = events.filter((e) => e.type !== 'frame').map((e) => e.type);
    expect(types[0]).toBe('phase');
    const reps = ofType(events, 'rep');
    expect(reps.map((r) => r.count)).toEqual([1, 2, 3]);
    expect(reps.every((r) => r.exercise === 'squat' && r.score === 100 && r.errors.length === 0)).toBe(true);
    // Чистый повтор: form_ok приходит прямо перед rep, как в моке.
    const okAt = types.indexOf('form_ok');
    expect(types[okAt + 1]).toBe('rep');
    const done = ofType(events, 'set_complete');
    expect(done).toHaveLength(1);
    expect(done[0]?.stats).toMatchObject({
      reps: 3,
      cleanReps: 3,
      avgScore: 100,
      errorCounts: {},
      perRep: [100, 100, 100],
    });
    // Четвёртый присед после set_complete не считается.
    expect(types.lastIndexOf('rep')).toBeLessThan(types.indexOf('set_complete'));
    const phases = ofType(events, 'phase').map((e) => e.phase);
    expect(phases.slice(0, 5)).toEqual(['start', 'down', 'bottom', 'up', 'start']);
    engine.stop();
  });

  it('ошибка техники: form_error до rep, rep с кодом и сниженной оценкой, в итогах счётчик ошибки', async () => {
    const noise = gaussian(0.002, 6);
    const frames = squatTrack({ reps: 2, depth: 65 }).map(({ t, thigh }) =>
      synthFrame(squatPose(thigh), t, noise),
    );
    const w = fakeWorld(script(frames));
    const { engine, events } = await started(w, { exercise: 'squat', targetReps: 2 });
    w.run(frames.at(-1)!.t + 500);
    const types = events.filter((e) => e.type !== 'frame').map((e) => e.type);
    const hint = ofType(events, 'form_error')[0];
    expect(hint).toMatchObject({ exercise: 'squat', code: 'shallow_depth', severity: 'bad', arrow: 'down' });
    expect(types.indexOf('form_error')).toBeLessThan(types.indexOf('rep'));
    expect(ofType(events, 'rep')[0]).toMatchObject({ errors: ['shallow_depth'], score: 70 });
    expect(ofType(events, 'form_ok')).toHaveLength(0);
    expect(ofType(events, 'set_complete')[0]?.stats.errorCounts).toEqual({ shallow_depth: 2 });
    engine.stop();
  });

  it('человек ушёл из кадра посреди подхода: пауза с подсказкой, вернулся — ok и счёт продолжается', async () => {
    const noise = gaussian(0.002, 7);
    const set1 = squatTrack({ reps: 1, depth: 100 }).map(({ t, thigh }) =>
      synthFrame(squatPose(thigh), t, noise),
    );
    const gapFrom = set1.at(-1)!.t;
    const set2 = squatTrack({ reps: 1, depth: 100 }).map(({ t, thigh }) =>
      synthFrame(squatPose(thigh), gapFrom + 3000 + t, noise),
    );
    const all = script([...set1, ...set2]);
    const w = fakeWorld((t) => (t > gapFrom && t < gapFrom + 3000 ? null : all(t)));
    const { engine, events } = await started(w, { exercise: 'squat', targetReps: 5 });
    w.run(set2.at(-1)!.t + 500);
    const calib = ofType(events, 'calibration').map((e) => e.status);
    expect(calib).toEqual(['no_person', 'ok']);
    expect(ofType(events, 'rep')).toHaveLength(2);
    engine.stop();
  });

  it('«звёздочка»: руки над головой на подходе — не жест «назад»; после итогов жест снова работает', async () => {
    const frames = jackFrames({ reps: 3 });
    const end = frames.at(-1)!.t;
    const jacks = script(frames);
    const w = fakeWorld((t) => (t <= end ? jacks(t) : { image: buildPose(BOTH_HANDS_UP), world: null }));
    const { engine, events } = await started(w, { exercise: 'jumping_jack', targetReps: 3 });
    w.run(end + 100);
    expect(ofType(events, 'rep')).toHaveLength(3);
    expect(ofType(events, 'gesture')).toHaveLength(0);
    w.run(1500);
    expect(ofType(events, 'gesture')).toHaveLength(1);
    engine.stop();
  });

  it('setMode до start запоминается; тот же режим повторно ничего не сбрасывает', async () => {
    const w = fakeWorld(standing);
    const engine = createRealEngine(w.deps);
    const events: EngineEvent[] = [];
    engine.on((e) => events.push(e));
    engine.setMode('menu');
    await engine.start(w.video);
    w.run(300);
    engine.setMode('menu');
    w.run(300);
    // В меню калибровка не шлётся (в режиме калибровки ok пришёл бы сразу).
    expect(ofType(events, 'calibration')).toEqual([]);
    engine.stop();
  });

  it('стемнело посреди подхода — подсказка «Слишком темно», а не «вернись в кадр»', async () => {
    let dark = false;
    const noise = gaussian(0.002, 8);
    const frames = squatTrack({ reps: 1, depth: 100 }).map(({ t, thigh }) =>
      synthFrame(squatPose(thigh), t, noise),
    );
    const all = script(frames);
    const w = fakeWorld((t) => (dark ? null : all(t)));
    w.deps.measureBrightness = () => (dark ? 15 : 120);
    const { engine, events } = await started(w, { exercise: 'squat', targetReps: 5 });
    w.run(frames.at(-1)!.t);
    dark = true;
    w.run(1500);
    expect(ofType(events, 'calibration').map((e) => e.status)).toEqual(['dark']);
    engine.stop();
  });

  it('упавший обработчик UI не останавливает движок и остальных подписчиков', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = fakeWorld(standing);
    const engine = createRealEngine(w.deps);
    let good = 0;
    engine.on(() => {
      throw new Error('UI упал');
    });
    engine.on(() => {
      good += 1;
    });
    await engine.start(w.video);
    w.run(500);
    error.mockRestore();
    expect(good).toBeGreaterThan(10);
    engine.stop();
  });

  it('упражнение, которого движок не знает, не роняет UI', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = fakeWorld(standing);
    const { engine, events } = await started(w, { exercise: 'arm_raise', targetReps: 5 });
    w.run(300);
    warn.mockRestore();
    expect(ofType(events, 'frame').length).toBeGreaterThan(0);
    engine.stop();
  });
});
