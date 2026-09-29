import { createSquatPress } from '../src/engine/exercises/squatPress';
import type { PoseFrame } from '../src/engine/geometry';
import { runSession } from './helpers/session';
import { gaussian, squatPose, synthFrame } from './helpers/synth';

const squatPress = createSquatPress();

/**
 * Подход «присед + руки вверх». Один повтор: присед (squatMs) → пауза стоя (pauseMs) → жим вверх и обратно
 * (pressMs) → отдых. Руки между повторами — у плеч (rack) или вдоль тела (armsDown).
 */
function thrusters(opts: {
  reps: number;
  depth?: number;
  press?: number;
  topElbow?: number;
  pauseMs?: number;
  armsDown?: boolean;
  fps?: number;
}): PoseFrame[] {
  const { reps, depth = 100, press = 1, topElbow = 0, pauseMs = 0, fps = 30 } = opts;
  const squatMs = 1400;
  const pressMs = 1200;
  const restMs = 600;
  const cycle = squatMs + pauseMs + pressMs + restMs;
  const noise = gaussian(0.003, 23);
  const lead = 1500;
  const wave = (x: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
  const frames: PoseFrame[] = [];
  const rack = opts.armsDown ? { arms: 10, elbow: 0 } : { arms: 20, elbow: 160 };
  for (let t = 0; t <= lead + reps * cycle + 1000; t += 1000 / fps) {
    const u = t - lead;
    let thigh = 0;
    let p = 0;
    if (u >= 0 && u < reps * cycle) {
      const c = u % cycle;
      if (c < squatMs) thigh = depth * wave(c / squatMs);
      else if (c >= squatMs + pauseMs && c < squatMs + pauseMs + pressMs)
        p = press * wave((c - squatMs - pauseMs) / pressMs);
    }
    // Из «у плеч» (или «вдоль тела») — в прямые руки над головой; в верхней точке локоть topElbow.
    const arms = rack.arms + p * (180 - rack.arms);
    const elbow = rack.elbow + p * (topElbow - rack.elbow);
    frames.push(synthFrame({ ...squatPose(thigh), arms, elbow }, t, noise));
  }
  return frames;
}

const shownCodes = (res: ReturnType<typeof runSession>) => res.shown.map((e) => e.code);

describe('присед + руки вверх', () => {
  it('6 правильных повторов — 6, без ошибок; на 15 FPS тоже', () => {
    const res = runSession(thrusters({ reps: 6 }), squatPress);
    expect(res.reps).toHaveLength(6);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
    expect(res.shown).toEqual([]);
    expect(runSession(thrusters({ reps: 6, fps: 15 }), squatPress).reps).toHaveLength(6);
  });

  it('присел → постоял → выжал: пауза не делит повтор на два', () => {
    const res = runSession(thrusters({ reps: 5, pauseMs: 1200 }), squatPress);
    expect(res.reps).toHaveLength(5);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
  });

  it('руки между повторами вдоль тела, а не у плеч — считается так же', () => {
    const res = runSession(thrusters({ reps: 5, armsDown: true }), squatPress);
    expect(res.reps).toHaveLength(5);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
  });

  it('неглубокий присед (бедро под 55°) — «сядь глубже»', () => {
    const res = runSession(thrusters({ reps: 5, depth: 55 }), squatPress);
    expect(res.reps).toHaveLength(5);
    expect(res.reps.every((r) => r.errors.includes('shallow_depth'))).toBe(true);
    expect(shownCodes(res)).toContain('shallow_depth');
  });

  it('руки не до конца или согнуты вверху — «выпрями руки над головой»', () => {
    const low = runSession(thrusters({ reps: 5, press: 0.55 }), squatPress);
    expect(low.reps).toHaveLength(5);
    expect(low.reps.every((r) => r.errors.includes('press_low'))).toBe(true);
    const bent = runSession(thrusters({ reps: 5, topElbow: 60 }), squatPress);
    expect(bent.reps.every((r) => r.errors.includes('press_low'))).toBe(true);
    expect(shownCodes(bent)).toContain('press_low');
  });

  it('только присед без жима — повтор с подсказкой про руки; только жим — про присед', () => {
    const squatOnly = runSession(thrusters({ reps: 4, press: 0 }), squatPress);
    expect(squatOnly.reps).toHaveLength(4);
    expect(squatOnly.reps.every((r) => r.errors.includes('press_low'))).toBe(true);
    const pressOnly = runSession(thrusters({ reps: 4, depth: 0 }), squatPress);
    expect(pressOnly.reps).toHaveLength(4);
    expect(pressOnly.reps.every((r) => r.errors.includes('shallow_depth'))).toBe(true);
  });

  it('стоит с кистями у плеч — ни повторов, ни подсказок', () => {
    const res = runSession(thrusters({ reps: 0 }), squatPress);
    expect(res.reps).toHaveLength(0);
    expect(res.attempts).toHaveLength(0);
    expect(res.shown).toEqual([]);
  });
});
