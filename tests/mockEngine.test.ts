import { afterEach, beforeEach, vi } from 'vitest';
import { createMockEngine, exercisePose, plannedError } from '../src/mocks/mockEngine';
import type { EngineEvent, SetStats } from '../src/engine/types';
import { FORM_ERRORS } from '../src/engine/hints';

const video = {} as HTMLVideoElement;

function collect(engine: ReturnType<typeof createMockEngine>) {
  const events: EngineEvent[] = [];
  engine.on((e) => events.push(e));
  return events;
}

const types = (events: EngineEvent[]) => events.map((e) => e.type);
const only = <T extends EngineEvent['type']>(events: EngineEvent[], type: T) =>
  events.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);

describe('мок-движок', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('шлёт frame с 33 точками и правдоподобным fps', async () => {
    const engine = createMockEngine({ autoRun: false });
    const events = collect(engine);
    await engine.start(video);
    vi.advanceTimersByTime(1000);
    engine.stop();

    const frames = only(events, 'frame');
    expect(frames.length).toBeGreaterThan(20);
    for (const f of frames) {
      expect(f.landmarks).toHaveLength(33);
      expect(f.fps).toBeGreaterThan(20);
    }
  });

  it('после stop() события не приходят', async () => {
    const engine = createMockEngine({ autoRun: false });
    const events = collect(engine);
    await engine.start(video);
    vi.advanceTimersByTime(300);
    engine.stop();
    const before = events.length;
    vi.advanceTimersByTime(3000);
    expect(events.length).toBe(before);
  });

  it('отписка через on() перестаёт получать события', async () => {
    const engine = createMockEngine({ autoRun: false });
    const seen: EngineEvent[] = [];
    const off = engine.on((e) => seen.push(e));
    await engine.start(video);
    vi.advanceTimersByTime(200);
    off();
    const before = seen.length;
    vi.advanceTimersByTime(500);
    engine.stop();
    expect(seen.length).toBe(before);
  });

  it('калибровка идёт partial → too_close → ok с подсказками', async () => {
    const engine = createMockEngine({ autoRun: false });
    const events = collect(engine);
    await engine.start(video);
    engine.setMode('calibration');
    vi.advanceTimersByTime(4000);
    engine.stop();

    const statuses = only(events, 'calibration').map((e) => e.status);
    expect(statuses[0]).toBe('partial');
    expect(statuses).toContain('too_close');
    expect(statuses.at(-1)).toBe('ok');
    for (const e of only(events, 'calibration')) expect(e.hint.length).toBeGreaterThan(5);
  });

  it('в меню курсор ходит плавно, теряется и даёт both_hands_up', async () => {
    const engine = createMockEngine({ autoRun: false });
    const events = collect(engine);
    await engine.start(video);
    engine.setMode('menu');
    vi.advanceTimersByTime(9000);
    engine.stop();

    const pointers = only(events, 'pointer');
    expect(pointers.length).toBeGreaterThan(50);
    for (const p of pointers) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
    // Плавность: внутри непрерывного отрезка (до потери руки) курсор не прыгает.
    let prev: { x: number; y: number } | null = null;
    let checked = 0;
    for (const e of events) {
      if (e.type === 'pointer_lost') prev = null;
      if (e.type !== 'pointer') continue;
      if (prev) {
        expect(Math.hypot(e.x - prev.x, e.y - prev.y)).toBeLessThan(0.05);
        checked += 1;
      }
      prev = { x: e.x, y: e.y };
    }
    expect(checked).toBeGreaterThan(40);
    expect(types(events)).toContain('pointer_lost');
    expect(only(events, 'gesture').map((e) => e.name)).toContain('both_hands_up');
  });

  it('сет упражнения даёт фазы, повторения, ошибки и итоги', async () => {
    const engine = createMockEngine({ autoRun: false });
    const events = collect(engine);
    await engine.start(video);
    engine.setMode({ exercise: 'squat', targetReps: 5 });
    vi.advanceTimersByTime(5 * 2400 + 1000);
    engine.stop();

    expect(new Set(only(events, 'phase').map((e) => e.phase))).toEqual(
      new Set(['start', 'down', 'bottom', 'up']),
    );

    const reps = only(events, 'rep');
    expect(reps.map((r) => r.count)).toEqual([1, 2, 3, 4, 5]);
    for (const r of reps) {
      expect(r.score).toBeGreaterThanOrEqual(20);
      expect(r.score).toBeLessThanOrEqual(100);
    }

    const errors = only(events, 'form_error');
    expect(errors.length).toBeGreaterThanOrEqual(3);
    const codes = FORM_ERRORS.squat.map((e) => e.code);
    for (const e of errors) {
      expect(codes).toContain(e.code);
      expect(e.message.length).toBeGreaterThan(10);
      expect(e.joints.length).toBeGreaterThan(0);
      expect(['warn', 'bad']).toContain(e.severity);
    }
    expect(errors.some((e) => e.arrow !== undefined)).toBe(true);
    expect(types(events)).toContain('form_ok');

    const done = only(events, 'set_complete');
    expect(done).toHaveLength(1);
    const stats: SetStats = done[0]!.stats;
    expect(stats.reps).toBe(5);
    expect(stats.perRep).toHaveLength(5);
    expect(stats.cleanReps).toBeGreaterThan(0);
    expect(stats.cleanReps).toBeLessThan(5);
    expect(stats.avgScore).toBeGreaterThan(20);
    expect(stats.durationSec).toBeCloseTo(12, 0);
    const counted = Object.values(stats.errorCounts).reduce((a, b) => a + b, 0);
    expect(counted).toBe(5 - stats.cleanReps);
  });

  it('автосценарий сам проходит калибровку, меню и первый сет', async () => {
    const engine = createMockEngine({ speed: 8 });
    const events = collect(engine);
    await engine.start(video);
    vi.advanceTimersByTime(40_000);
    engine.stop();

    const seen = new Set(types(events));
    for (const t of [
      'frame',
      'calibration',
      'pointer',
      'pointer_lost',
      'gesture',
      'phase',
      'rep',
      'form_error',
      'form_ok',
      'set_complete',
    ]) {
      expect(seen).toContain(t);
    }
  });

  it('все упражнения дают свои ошибки из каталога', async () => {
    for (const exercise of ['squat', 'jumping_jack', 'lunge', 'arm_raise'] as const) {
      const engine = createMockEngine({ autoRun: false });
      const events = collect(engine);
      await engine.start(video);
      engine.setMode({ exercise, targetReps: 6 });
      vi.advanceTimersByTime(6 * 2400 + 1000);
      engine.stop();

      const got = new Set(only(events, 'form_error').map((e) => e.code));
      expect(got.size).toBeGreaterThanOrEqual(Math.min(2, FORM_ERRORS[exercise].length));
      for (const code of got) expect(FORM_ERRORS[exercise].map((e) => e.code)).toContain(code);
      expect(only(events, 'set_complete')[0]?.stats.reps).toBe(6);
    }
  });

  it('план ошибок: первое повторение чистое, дальше идут разные ошибки', () => {
    expect(plannedError('squat', 0)).toBeNull();
    expect(plannedError('squat', 1)?.code).toBe('shallow_depth');
    expect(plannedError('squat', 2)?.code).toBe('knees_in');
    expect(plannedError('squat', 3)).toBeNull();
  });

  it('поза упражнения показывает саму ошибку: мелкий присед остаётся выше', () => {
    const deep = exercisePose('squat', 0.5, null);
    const shallow = exercisePose('squat', 0.5, plannedError('squat', 1));
    expect(shallow.squat).toBeLessThan(deep.squat);
    const lean = exercisePose('squat', 0.5, plannedError('squat', 4));
    expect(lean.lean).toBeGreaterThan(20);
  });
});
