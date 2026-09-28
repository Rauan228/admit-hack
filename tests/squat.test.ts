import { RepCounter, type FsmEvent } from '../src/engine/exercises/fsm';
import { createSquat, squatProgress } from '../src/engine/exercises/squat';
import { LandmarkSmoother, smoothPose } from '../src/engine/filter';
import type { PoseFrame } from '../src/engine/geometry';
import { loadFixture, replay } from './helpers/replay';
import { gaussian, squatPose, squatTrack, synthFrame, type SynthParams } from './helpers/synth';

/** Прогон синтетического подхода через тот же конвейер, что в движке. */
function runSynthetic(frames: PoseFrame[]): FsmEvent[] {
  const def = createSquat();
  const meter = def.createMeter();
  const counter = new RepCounter(def.fsm);
  const smoother = new LandmarkSmoother();
  const out: FsmEvent[] = [];
  for (const raw of frames) {
    const f = smoothPose(smoother, raw.image, raw.world, raw.t, raw.aspect);
    const m = meter.measure(f, counter.phase);
    if (m) out.push(...counter.update(m.progress, f.t));
  }
  return out;
}

function squatSet(
  opts: Parameters<typeof squatTrack>[0],
  extra: Partial<SynthParams> = {},
  sigma = 0.003,
  seed = 1,
): PoseFrame[] {
  const noise = gaussian(sigma, seed);
  return squatTrack(opts).map(({ t, thigh }) => synthFrame(squatPose(thigh, extra), t, noise));
}

const count = (ev: FsmEvent[], kind: FsmEvent['kind']) => ev.filter((e) => e.kind === kind).length;

describe('приседания: глубина по вертикали бедра', () => {
  it('стоя прогресс 0, у параллели ~1, ниже параллели > 1', () => {
    expect(squatProgress(1)).toBeCloseTo(0);
    expect(squatProgress(0.1)).toBeCloseTo(1);
    expect(squatProgress(-0.2)).toBeGreaterThan(1.2);
  });

  it('анфас глубина видна, хотя 2D-угол колена почти не меняется', () => {
    const def = createSquat();
    const meter = def.createMeter();
    const stand = meter.measure(synthFrame(squatPose(0), 0), 'start');
    const parallel = meter.measure(synthFrame(squatPose(90), 33), 'bottom');
    expect(stand?.thighRatio).toBeCloseTo(1, 2);
    expect(parallel?.thighRatio).toBeCloseTo(0, 1);
    expect(parallel?.progress).toBeGreaterThan(0.95);
  });

  it('сбоку видна одна нога — меряем по ней', () => {
    const def = createSquat();
    const meter = def.createMeter();
    const hideRight = (f: PoseFrame) => {
      for (const i of [24, 26, 28]) f.image[i] = { ...(f.image[i] as PoseFrame['image'][number]), v: 0.1 };
      return f;
    };
    meter.measure(hideRight(synthFrame(squatPose(0), 0)), 'start');
    const m = meter.measure(hideRight(synthFrame(squatPose(90), 33)), 'bottom');
    expect(m?.thighRatioR).toBeNull();
    expect(m?.thighRatioL).not.toBeNull();
    expect(m?.progress).toBeGreaterThan(0.95);
  });

  it('ног не видно — метрик нет (движок поставит паузу, а не насчитает ерунды)', () => {
    const meter = createSquat().createMeter();
    const f = synthFrame(squatPose(0), 0);
    for (const i of [23, 24, 25, 26]) f.image[i] = { ...(f.image[i] as PoseFrame['image'][number]), v: 0.1 };
    expect(meter.measure(f, 'start')).toBeNull();
  });
});

describe('приседания: счёт (критерий E-08 — 10 приседаний = 10)', () => {
  it('10 приседаний до параллели анфас, 30 FPS, шум модели — ровно 10', () => {
    const ev = runSynthetic(squatSet({ reps: 10, depth: 95 }));
    expect(count(ev, 'rep')).toBe(10);
    expect(count(ev, 'attempt')).toBe(0);
  });

  it('то же на 15 FPS (слабый телефон) — ровно 10', () => {
    const ev = runSynthetic(squatSet({ reps: 10, depth: 95, fps: 15 }));
    expect(count(ev, 'rep')).toBe(10);
  });

  it('быстрые приседания без паузы наверху — 10', () => {
    const ev = runSynthetic(
      squatSet({ reps: 10, depth: 100, downMs: 550, holdMs: 0, upMs: 500, restMs: 100 }),
    );
    expect(count(ev, 'rep')).toBe(10);
  });

  it('медленные с остановкой внизу на 1,5 с — 10', () => {
    const ev = runSynthetic(squatSet({ reps: 10, depth: 100, downMs: 2000, holdMs: 1500, upMs: 1500 }));
    expect(count(ev, 'rep')).toBe(10);
  });

  it('сильный шум модели (σ = 0,6 % кадра) не даёт лишних повторов', () => {
    for (const seed of [1, 2, 3]) {
      const ev = runSynthetic(squatSet({ reps: 10, depth: 95 }, {}, 0.006, seed));
      expect(count(ev, 'rep')).toBe(10);
    }
  });

  it('человек просто стоит 10 секунд — 0 повторов', () => {
    const ev = runSynthetic(squatSet({ reps: 0, depth: 0, leadMs: 10000 }, {}, 0.005));
    expect(count(ev, 'rep')).toBe(0);
    expect(count(ev, 'attempt')).toBe(0);
  });

  it('полуприсед (бедро 65°) — повтор засчитан (ошибку «мало глубины» даст правило)', () => {
    const ev = runSynthetic(squatSet({ reps: 5, depth: 65 }));
    expect(count(ev, 'rep')).toBe(5);
  });

  it('четверть-присед (бедро 50°) — не повтор, но попытка: движок подскажет «глубже»', () => {
    const ev = runSynthetic(squatSet({ reps: 5, depth: 50 }));
    expect(count(ev, 'rep')).toBe(0);
    expect(count(ev, 'attempt')).toBe(5);
  });

  it('человек подошёл к камере (стал крупнее) — эталон подстроился, лишних повторов нет', () => {
    const noise = gaussian(0.003, 5);
    const frames: PoseFrame[] = [];
    // 2 с подходит: рост в кадре 0,55 → 0,8, стопы опускаются.
    for (let i = 0; i <= 60; i++) {
      const k = i / 60;
      frames.push(
        synthFrame(squatPose(0, { height: 0.55 + 0.25 * k, footY: 0.8 + 0.12 * k }), i * 33, noise),
      );
    }
    const t0 = frames.length * 33;
    for (const { t, thigh } of squatTrack({ reps: 3, depth: 95, leadMs: 500 })) {
      frames.push(synthFrame(squatPose(thigh, { height: 0.8 }), t0 + t, noise));
    }
    const ev = runSynthetic(frames);
    expect(count(ev, 'rep')).toBe(3);
  });

  it('человек отошёл от камеры (стал мельче) — всё равно 3', () => {
    const noise = gaussian(0.003, 6);
    const frames: PoseFrame[] = [];
    for (let i = 0; i <= 60; i++) {
      const k = i / 60;
      frames.push(synthFrame(squatPose(0, { height: 0.85 - 0.3 * k, footY: 0.95 - 0.1 * k }), i * 33, noise));
    }
    const t0 = frames.length * 33;
    for (const { t, thigh } of squatTrack({ reps: 3, depth: 95, leadMs: 3500 })) {
      frames.push(synthFrame(squatPose(thigh, { height: 0.55, footY: 0.85 }), t0 + t, noise));
    }
    expect(count(runSynthetic(frames), 'rep')).toBe(3);
  });
});

describe('приседания на реальных записях (Wikimedia Commons → MediaPipe)', () => {
  const cases = [
    ['squat-front-goblet.json', 2],
    ['squat-rear-barbell.json', 2],
    ['squat-side-goblet.json', 6],
    ['squat-side-backlit.json', 6],
  ] as const;

  it.each(cases)('%s — %i повторов на 30 FPS', (name, expected) => {
    const file = loadFixture(name);
    expect((file.meta as { expected: { reps: number } }).expected.reps).toBe(expected);
    expect(replay(file, createSquat()).reps).toBe(expected);
  });

  it.each(cases)('%s — %i повторов на 15 FPS', (name, expected) => {
    expect(replay(loadFixture(name), createSquat(), 2).reps).toBe(expected);
  });

  it('сбоку и со спины каждый повтор — ниже параллели (прогресс > 1)', () => {
    for (const [name] of cases) {
      const reps = replay(loadFixture(name), createSquat()).events.flatMap((e) =>
        e.kind === 'rep' ? [e.summary.pMax] : [],
      );
      expect(reps.every((p) => p > 1)).toBe(true);
    }
  });
});
