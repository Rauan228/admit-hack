// Движок и кисти (E-36): модель кисти зовётся только пока идёт удар, ладонь отменяет удар, кулак — нет;
// медленная модель выключается, и удары снова считаются как есть.

import { createRealEngine, type EngineDeps } from '../src/engine/Engine';
import type { HandDetector } from '../src/engine/hands';
import type { PoseDetection, PoseDetector } from '../src/engine/pose';
import type { EngineEvent } from '../src/engine/types';
import { gaussian, STAND, synthFrame } from './helpers/synth';

const wave = (x: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);

/** Десять ударов по очереди, по 800 мс, с 1,5 с. */
function punchAt(t: number): PoseDetection {
  const noise = gaussian(0.003, 3);
  const u = t - 1500;
  const period = 800;
  const inSet = u >= 0 && u < 10 * period;
  const rep = inSet ? Math.floor(u / period) : 0;
  const k = inSet ? wave((u % period) / period) : 0;
  const f = synthFrame(
    { ...STAND, ...(rep % 2 === 0 ? { punchL: k, punchR: 0 } : { punchR: k, punchL: 0 }) },
    t,
    noise,
  );
  return { image: f.image, world: null };
}

function world(hand: { state: 'fist' | 'open' | 'unknown'; costMs?: number }) {
  let queued: (() => void) | null = null;
  let clock = 0;
  const video = { readyState: 4, currentTime: 0, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement & {
    currentTime: number;
  };
  const detector = {
    delegate: 'GPU',
    model: 'lite',
    detect: (_v: unknown, t: number) => punchAt(t),
    close: vi.fn(),
  } as unknown as PoseDetector;
  const hands: HandDetector & { calls: number[] } = {
    delegate: 'CPU',
    calls: [],
    detect: vi.fn(() => {
      hands.calls.push(clock);
      clock += hand.costMs ?? 0;
      return hand.state;
    }),
    close: vi.fn(),
  };
  const deps: EngineDeps = {
    openCamera: async () => ({}) as MediaStream,
    stopCamera: () => undefined,
    createPoseDetector: async () => detector,
    requestFrame: (cb) => {
      queued = cb;
      return 1;
    },
    cancelFrame: () => {
      queued = null;
    },
    now: () => clock,
    measureBrightness: () => 120,
    createHandDetector: vi.fn(async () => hands),
  };
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 1000 / 30) {
      clock += 1000 / 30;
      video.currentTime += 1 / 30;
      const cb = queued;
      queued = null;
      cb?.();
    }
  };
  return { deps, video, hands, run, events: [] as EngineEvent[] };
}

async function fight(hand: Parameters<typeof world>[0]) {
  const w = world(hand);
  const engine = createRealEngine(w.deps);
  engine.on((e) => w.events.push(e));
  engine.setMode({ exercise: 'boxing', targetReps: 100 });
  await engine.start(w.video);
  // Модель кисти грузится асинхронно — даём промису пройти.
  await Promise.resolve();
  await Promise.resolve();
  w.run(1500 + 10 * 800 + 1000);
  engine.stop();
  const reps = w.events.filter((e) => e.type === 'rep').length;
  const hints = [
    ...new Set(w.events.filter((e) => e.type === 'form_error').map((e) => (e as { code: string }).code)),
  ];
  return { ...w, reps, hints };
}

describe('движок: проверка кулака в боксе', () => {
  it('кулак — все 10 ударов; модель кисти зовётся только во время ударов, не на каждом кадре', async () => {
    const r = await fight({ state: 'fist' });
    expect(r.reps).toBe(10);
    expect(r.hints).toEqual([]);
    expect(r.deps.createHandDetector).toHaveBeenCalledTimes(1);
    const calls = (r.hands.detect as ReturnType<typeof vi.fn>).mock.calls.length;
    // Только бьющая кисть и только в движении: не больше одного вызова на кадр (~315 кадров), но больше нуля.
    expect(calls).toBeGreaterThan(20);
    expect(calls).toBeLessThanOrEqual(315);
    // До первого удара (1,5 с стойки) кисти не проверялись.
    expect(Math.min(...r.hands.calls)).toBeGreaterThan(1400);
    expect(r.hands.close).toHaveBeenCalled();
  });

  it('раскрытая ладонь — ни одного удара и подсказка «сожми кулак»', async () => {
    const r = await fight({ state: 'open' });
    expect(r.reps).toBe(0);
    expect(r.hints).toContain('open_hand');
  });

  it('кисть не распознана — удары считаются', async () => {
    const r = await fight({ state: 'unknown' });
    expect(r.reps).toBe(10);
  });

  it('модель кисти слишком медленная — выключается, удары считаются как есть', async () => {
    const r = await fight({ state: 'open', costMs: 60 });
    // Первые проверки ещё успели запретить удар-другой, потом проверка выключена — остальное засчитано.
    expect(r.reps).toBeGreaterThanOrEqual(7);
    expect(r.hands.close).toHaveBeenCalledTimes(1);
    const calls = (r.hands.detect as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(calls).toBeLessThanOrEqual(12);
  });

  it('без детектора кистей в зависимостях — всё как раньше', async () => {
    const w = world({ state: 'open' });
    delete w.deps.createHandDetector;
    const engine = createRealEngine(w.deps);
    engine.on((e) => w.events.push(e));
    engine.setMode({ exercise: 'boxing', targetReps: 100 });
    await engine.start(w.video);
    w.run(1500 + 10 * 800 + 1000);
    engine.stop();
    expect(w.events.filter((e) => e.type === 'rep')).toHaveLength(10);
  });
});
