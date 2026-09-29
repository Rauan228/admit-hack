import { createKneeToElbow } from '../src/engine/exercises/kneeToElbow';
import type { PoseFrame } from '../src/engine/geometry';
import { runSession } from './helpers/session';
import { gaussian, STAND, synthFrame } from './helpers/synth';

const kneeToElbow = createKneeToElbow();

/** Касания по очереди: правое колено + левый локоть, потом левое колено + правый локоть. */
function touches(opts: {
  reps: number;
  crunch?: number;
  lift?: number;
  periodMs?: number;
  fps?: number;
}): PoseFrame[] {
  const { reps, crunch = 1, lift = 80, periodMs = 1500, fps = 30 } = opts;
  const noise = gaussian(0.003, 17);
  const lead = 1500;
  const frames: PoseFrame[] = [];
  for (let t = 0; t <= lead + reps * periodMs + 1000; t += 1000 / fps) {
    const u = t - lead;
    const inSet = u >= 0 && u < reps * periodMs;
    const rep = inSet ? Math.floor(u / periodMs) : 0;
    const w = inSet ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (u % periodMs)) / periodMs) : 0;
    const right = rep % 2 === 0;
    frames.push(
      synthFrame(
        {
          ...STAND,
          handsBehindHead: true,
          lean: 15 * w,
          crunch: crunch * w,
          crunchElbow: right ? 'left' : 'right',
          ...(right ? { liftR: lift * w } : { liftL: lift * w }),
        },
        t,
        noise,
      ),
    );
  }
  return frames;
}

const shownCodes = (res: ReturnType<typeof runSession>) => res.shown.map((e) => e.code);

describe('локоть к колену', () => {
  it('8 касаний по очереди — 8 повторов без ошибок; на 15 FPS тоже', () => {
    const res = runSession(touches({ reps: 8 }), kneeToElbow);
    expect(res.reps).toHaveLength(8);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
    expect(res.shown).toEqual([]);
    expect(runSession(touches({ reps: 8, fps: 15 }), kneeToElbow).reps).toHaveLength(8);
  });

  it('стороны чередуются: к правому колену, к левому', () => {
    const res = runSession(touches({ reps: 4 }), kneeToElbow);
    expect(res.reps.map((r) => r.ctx.atBottom.side)).toEqual(['right', 'left', 'right', 'left']);
  });

  it('локоть не дотянулся — «тянись локтем к колену» (и в засчитанном, и в попытке)', () => {
    const res = runSession(touches({ reps: 6, crunch: 0.6 }), kneeToElbow);
    expect(shownCodes(res)).toContain('elbow_far');
    const all = [...res.reps, ...res.attempts];
    expect(all.length).toBe(6);
    expect(all.every((r) => r.errors.includes('elbow_far'))).toBe(true);
  });

  it('локоть дошёл, а колено почти не поднялось — «подними колено»', () => {
    const res = runSession(touches({ reps: 6, lift: 20 }), kneeToElbow);
    expect(res.reps.length).toBeGreaterThanOrEqual(5);
    expect(res.reps.every((r) => r.errors.includes('knee_low'))).toBe(true);
    expect(shownCodes(res)).toContain('knee_low');
  });

  it('стоит с руками за головой — ни повторов, ни подсказок', () => {
    const res = runSession(touches({ reps: 0 }), kneeToElbow);
    expect(res.reps).toHaveLength(0);
    expect(res.attempts).toHaveLength(0);
    expect(res.shown).toEqual([]);
  });

  it('колено поднимается без скручивания (просто шаг) — не повтор', () => {
    const res = runSession(touches({ reps: 6, crunch: 0 }), kneeToElbow);
    expect(res.reps).toHaveLength(0);
  });
});
