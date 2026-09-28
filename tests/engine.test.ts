import { createRealEngine, type EngineDeps } from '../src/engine/Engine';
import type { PoseDetector } from '../src/engine/pose';
import type { EngineEvent, Landmark } from '../src/engine/types';

const POSE: Landmark[] = Array.from({ length: 33 }, (_, i) => ({ x: i / 33, y: 0.5, z: 0, v: 1 }));

/** Фейковый браузер: кадры крутим вручную через flush(), время задаём сами. */
function fakeWorld(detect: PoseDetector['detect'] = () => ({ image: POSE, world: null })) {
  let queued: (() => void) | null = null;
  let clock = 0;
  const video = { readyState: 4, currentTime: 0 } as HTMLVideoElement & { currentTime: number };
  const stream = { stopped: false } as unknown as MediaStream & { stopped: boolean };
  const detector = { delegate: 'CPU', model: 'lite', detect: vi.fn(detect), close: vi.fn() };

  const deps: EngineDeps = {
    openCamera: vi.fn(async () => stream),
    stopCamera: vi.fn((s) => {
      if (s) (s as typeof stream).stopped = true;
    }),
    createPoseDetector: vi.fn(async () => detector as PoseDetector),
    requestFrame: (cb) => {
      queued = cb;
      return 1;
    },
    cancelFrame: () => {
      queued = null;
    },
    now: () => clock,
  };

  /** Новый видеокадр через 33 мс и один тик rAF. */
  const flush = (newVideoFrame = true) => {
    clock += 33;
    if (newVideoFrame) video.currentTime += 0.033;
    const cb = queued;
    queued = null;
    cb?.();
  };
  return { deps, video, stream, detector, flush };
}

describe('реальный движок (E-04)', () => {
  it('после start шлёт frame с 33 точками и FPS', async () => {
    const w = fakeWorld();
    const engine = createRealEngine(w.deps);
    const frames: Extract<EngineEvent, { type: 'frame' }>[] = [];
    engine.on((e) => e.type === 'frame' && frames.push(e));

    await engine.start(w.video);
    for (let i = 0; i < 40; i++) w.flush();

    expect(frames).toHaveLength(40);
    expect(frames[0]?.landmarks).toHaveLength(33);
    expect(frames.at(-1)?.fps).toBe(30);
    engine.stop();
  });

  it('обрабатывает только новые видеокадры, а не каждый тик rAF', async () => {
    const w = fakeWorld();
    const engine = createRealEngine(w.deps);
    await engine.start(w.video);
    w.flush(true);
    w.flush(false);
    w.flush(false);
    w.flush(true);
    expect(w.detector.detect).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it('никого в кадре → frame с пустым массивом, чтобы UI стёр скелет', async () => {
    const w = fakeWorld(() => null);
    const engine = createRealEngine(w.deps);
    const seen: EngineEvent[] = [];
    engine.on((e) => seen.push(e));
    await engine.start(w.video);
    w.flush();
    expect(seen[0]).toMatchObject({ type: 'frame', landmarks: [] });
    engine.stop();
  });

  it('битый кадр пропускается, цикл продолжается', async () => {
    let calls = 0;
    const w = fakeWorld(() => {
      calls++;
      if (calls === 1) throw new Error('GPU hiccup');
      return { image: POSE, world: null };
    });
    const engine = createRealEngine(w.deps);
    const seen: EngineEvent[] = [];
    engine.on((e) => seen.push(e));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await engine.start(w.video);
    w.flush();
    w.flush();
    warn.mockRestore();
    expect(seen).toHaveLength(1);
    engine.stop();
  });

  it('stop гасит камеру, закрывает модель и останавливает цикл', async () => {
    const w = fakeWorld();
    const engine = createRealEngine(w.deps);
    const seen: EngineEvent[] = [];
    engine.on((e) => seen.push(e));
    await engine.start(w.video);
    engine.stop();
    w.flush();
    expect(seen).toHaveLength(0);
    expect(w.stream.stopped).toBe(true);
    expect(w.detector.close).toHaveBeenCalled();
  });

  it('stop во время загрузки модели не оставляет камеру включённой', async () => {
    const w = fakeWorld();
    let release!: () => void;
    w.deps.createPoseDetector = () =>
      new Promise((resolve) => {
        release = () => resolve(w.detector as PoseDetector);
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
