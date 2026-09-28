// Помощники тестов: шум модели и готовые подходы (приседания, «звёздочка», выпады).
// Сам скелет — в src/engine/skeleton.ts: тот же, по которому строится «призрак».

import type { PoseFrame } from '../../src/engine/geometry';
import { lungeFrame, squatPose, STAND, synthFrame } from '../../src/engine/skeleton';

export { lungeFrame, squatPose, STAND, synthFrame };
export type { LungeParams, SynthParams } from '../../src/engine/skeleton';

/** Детерминированный гауссов шум с сигмой sigma (доли кадра). */
export function gaussian(sigma: number, seed = 1): () => number {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return (((x ^ (x >>> 14)) >>> 0) + 1) / 4294967297;
  };
  return () => sigma * Math.sqrt(-2 * Math.log(uni())) * Math.cos(2 * Math.PI * uni());
}

/** Траектория приседаний: список (время, угол бедра). */
export function squatTrack(opts: {
  reps: number;
  depth: number;
  fps?: number;
  downMs?: number;
  holdMs?: number;
  upMs?: number;
  restMs?: number;
  leadMs?: number;
}): { t: number; thigh: number }[] {
  const {
    reps,
    depth,
    fps = 30,
    downMs = 1000,
    holdMs = 200,
    upMs = 900,
    restMs = 600,
    leadMs = 1000,
  } = opts;
  const dt = 1000 / fps;
  const out: { t: number; thigh: number }[] = [];
  const cycle = downMs + holdMs + upMs + restMs;
  const total = leadMs + reps * cycle + 1000;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  for (let t = 0; t <= total; t += dt) {
    const u = t - leadMs;
    let thigh = 0;
    if (u >= 0 && u < reps * cycle) {
      const c = u % cycle;
      if (c < downMs) thigh = depth * ease(c / downMs);
      else if (c < downMs + holdMs) thigh = depth;
      else if (c < downMs + holdMs + upMs) thigh = depth * (1 - ease((c - downMs - holdMs) / upMs));
    }
    out.push({ t, thigh });
  }
  return out;
}

/** Прыжки «звёздочка»: руки вверх и ноги в стороны по косинусу; ноги могут отставать на legLagMs. */
export function jackFrames(opts: {
  reps: number;
  periodMs?: number;
  fps?: number;
  armTop?: number;
  armTopL?: number;
  stanceRest?: number;
  stanceTop?: number;
  legLagMs?: number;
  leadMs?: number;
  sigma?: number;
  seed?: number;
}): PoseFrame[] {
  const {
    reps,
    periodMs = 900,
    fps = 30,
    armTop = 170,
    armTopL,
    stanceRest = 1.0,
    stanceTop = 4.0,
    legLagMs = 0,
    leadMs = 1500,
    sigma = 0.003,
    seed = 11,
  } = opts;
  const noise = gaussian(sigma, seed);
  const wave = (u: number) =>
    u < 0 || u >= reps * periodMs ? 0 : 0.5 - 0.5 * Math.cos((2 * Math.PI * (u % periodMs)) / periodMs);
  const out: PoseFrame[] = [];
  const total = leadMs + reps * periodMs + legLagMs + 1200;
  for (let t = 0; t <= total; t += 1000 / fps) {
    const a = wave(t - leadMs);
    const l = wave(t - leadMs - legLagMs);
    const params = {
      ...STAND,
      arms: 10 + a * (armTop - 10),
      stance: stanceRest + l * (stanceTop - stanceRest),
      thigh: l * 10,
      shin: l * 4,
    };
    const frame = synthFrame(params, t, noise);
    if (armTopL !== undefined) {
      // Левая рука поднимается ниже: пересчитываем только её (запястье, локоть).
      const one = synthFrame({ ...params, arms: 10 + a * (armTopL - 10) }, t, noise);
      for (const i of [13, 15, 17, 19, 21]) frame.image[i] = one.image[i]!;
    }
    out.push(frame);
  }
  return out;
}

/** Подход выпадов: ноги чередуются; hold — удержание внизу, мс. */
export function lungeSet(opts: {
  reps: number;
  depth?: number;
  fps?: number;
  downMs?: number;
  holdMs?: number;
  upMs?: number;
  restMs?: number;
  kneeForward?: number;
  lean?: number;
  sigma?: number;
  seed?: number;
}): PoseFrame[] {
  const { reps, depth = 1, fps = 30, downMs = 900, holdMs = 300, upMs = 900, restMs = 700 } = opts;
  const noise = gaussian(opts.sigma ?? 0.003, opts.seed ?? 21);
  const cycle = downMs + holdMs + upMs + restMs;
  const lead = 1500;
  const out: PoseFrame[] = [];
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  for (let t = 0; t <= lead + reps * cycle + 1200; t += 1000 / fps) {
    const u = t - lead;
    let d = 0;
    let rep = 0;
    if (u >= 0 && u < reps * cycle) {
      rep = Math.floor(u / cycle);
      const c = u % cycle;
      if (c < downMs) d = ease(c / downMs);
      else if (c < downMs + holdMs) d = 1;
      else if (c < downMs + holdMs + upMs) d = 1 - ease((c - downMs - holdMs) / upMs);
    }
    out.push(
      lungeFrame(
        {
          depth: d * depth,
          back: rep % 2 === 0 ? 'right' : 'left',
          kneeForward: (opts.kneeForward ?? 0) * d,
          lean: (opts.lean ?? 0) * d,
        },
        t,
        noise,
      ),
    );
  }
  return out;
}
