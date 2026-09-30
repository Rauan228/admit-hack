// Упражнения стоя (E-22): наклоны в стороны, отведение ноги, боковые выпады, присед с выпрыгиванием,
// подъём на носки, «звёздочка» с перекрёстом, круги руками. Для каждого: правильная техника — ровно N
// повторов без ошибок (и на 15 FPS), каждая ошибка ловится, стойка без движения — ни повторов, ни подсказок.

import { createExercise } from '../src/engine/exercises';
import type { BaseMetrics, ExerciseDef } from '../src/engine/exercises/types';
import type { PoseFrame } from '../src/engine/geometry';
import { sideLungeFrame, type SideLungeParams, type SynthParams } from '../src/engine/skeleton';
import type { ExerciseId } from '../src/engine/types';
import { runSession } from './helpers/session';
import { gaussian, squatPose, STAND, synthFrame } from './helpers/synth';

const def = (id: ExerciseId) => createExercise(id) as ExerciseDef<BaseMetrics>;
const wave = (x: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);

/** Подход: 1,5 с стоя, reps циклов по periodMs, 1 с стоя. pose(k, rep) — поза в фазе k ∈ [0, 1) повтора rep. */
function track(
  reps: number,
  periodMs: number,
  pose: (k: number, rep: number) => Partial<SynthParams>,
  opts: { fps?: number; seed?: number; rest?: Partial<SynthParams> } = {},
): PoseFrame[] {
  const noise = gaussian(0.003, opts.seed ?? 5);
  const frames: PoseFrame[] = [];
  const lead = 1500;
  for (let t = 0; t <= lead + reps * periodMs + 1000; t += 1000 / (opts.fps ?? 30)) {
    const u = t - lead;
    const inSet = u >= 0 && u < reps * periodMs;
    const extra = inSet ? pose((u % periodMs) / periodMs, Math.floor(u / periodMs)) : (opts.rest ?? {});
    frames.push(synthFrame({ ...STAND, ...(opts.rest ?? {}), ...extra }, t, noise));
  }
  return frames;
}

function lungeTrack(reps: number, p: Omit<SideLungeParams, 'depth' | 'side'> & { depth?: number }, fps = 30) {
  const noise = gaussian(0.003, 9);
  const frames: PoseFrame[] = [];
  const periodMs = 2600;
  for (let t = 0; t <= 1500 + reps * periodMs + 1000; t += 1000 / fps) {
    const u = t - 1500;
    const inSet = u >= 0 && u < reps * periodMs;
    const rep = inSet ? Math.floor(u / periodMs) : 0;
    // Выпад за 2 с, потом 0,6 с стоя в центре — как у живого человека между сторонами.
    const k = (u % periodMs) / 2000;
    const depth = inSet && k < 1 ? (p.depth ?? 1) * wave(k) : 0;
    frames.push(sideLungeFrame({ ...p, depth, side: rep % 2 === 0 ? 'left' : 'right' }, t, noise));
  }
  return frames;
}

const errorsOf = (res: ReturnType<typeof runSession>) => res.reps.flatMap((r) => r.errors);
const shown = (res: ReturnType<typeof runSession>) => res.shown.map((e) => e.code);
const clean = (frames: PoseFrame[], id: ExerciseId, n: number) => {
  const res = runSession(frames, def(id));
  expect(res.reps).toHaveLength(n);
  expect(errorsOf(res)).toEqual([]);
  expect(res.shown).toEqual([]);
};

describe('наклоны в стороны', () => {
  const bends = (tilt: number, extra: Partial<SynthParams> = {}, fps = 30) =>
    track(8, 2000, (k, rep) => ({ sideTilt: (rep % 2 ? -1 : 1) * tilt * wave(k), ...extra }), { fps });

  it('8 наклонов на 28° — 8, без ошибок; на 15 FPS тоже', () => {
    clean(bends(28), 'side_bend', 8);
    clean(bends(28, {}, 15), 'side_bend', 8);
  });
  it('маятником (влево — сразу вправо, у вертикали не задерживается) — каждый наклон отдельно, и на 15 FPS', () => {
    // В «прямо» (меньше 6°) человек проводит ~115 мс — меньше, чем счётчик ждёт подтверждения возврата.
    const swing = (fps: number) =>
      track(4, 2000, (k) => ({ sideTilt: 35 * Math.sin(2 * Math.PI * k) }), { fps });
    clean(swing(30), 'side_bend', 8);
    clean(swing(15), 'side_bend', 8);
  });
  it('наклон на 17° — «наклонись ниже»', () => {
    const res = runSession(bends(17), def('side_bend'));
    expect(res.reps).toHaveLength(8);
    expect(res.reps.every((r) => r.errors.includes('shallow_bend'))).toBe(true);
  });
  it('наклон вперёд вместо вбок — «строго в сторону»', () => {
    const res = runSession(
      track(6, 2000, (k, rep) => ({ sideTilt: (rep % 2 ? -1 : 1) * 28 * wave(k), lean: 35 * wave(k) })),
      def('side_bend'),
    );
    expect(shown(res)).toContain('lean_forward');
  });
  it('валится всем телом (таз уезжает в сторону наклона) — «таз на месте»', () => {
    const res = runSession(
      track(6, 2000, (k) => ({ sideTilt: 45 * wave(k), shift: 1.2 * wave(k) })),
      def('side_bend'),
    );
    expect(shown(res)).toContain('hips_shift');
  });
});

describe('отведение ноги в сторону', () => {
  const raises = (deg: number, extra: (k: number) => Partial<SynthParams> = () => ({}), fps = 30) =>
    track(
      8,
      1800,
      (k, rep) => ({ ...(rep % 2 ? { abductR: deg * wave(k) } : { abductL: deg * wave(k) }), ...extra(k) }),
      { fps },
    );

  it('8 отведений на 44° — 8, без ошибок; на 15 FPS тоже', () => {
    clean(raises(44), 'side_leg_raise', 8);
    clean(
      raises(44, () => ({}), 15),
      'side_leg_raise',
      8,
    );
  });
  it('нога на 28° — «отведи выше»', () => {
    const res = runSession(raises(28), def('side_leg_raise'));
    expect(res.reps).toHaveLength(8);
    expect(res.reps.every((r) => r.errors.includes('leg_low'))).toBe(true);
  });
  it('корпус заваливается в сторону — «не наклоняй корпус»', () => {
    expect(
      shown(
        runSession(
          raises(44, (k) => ({ sideTilt: -22 * wave(k) })),
          def('side_leg_raise'),
        ),
      ),
    ).toContain('torso_tilt');
  });
  it('колено согнуто — «нога прямая»', () => {
    const res = runSession(
      raises(44, () => ({ abductKnee: 45 })),
      def('side_leg_raise'),
    );
    expect(res.reps.every((r) => r.errors.includes('knee_bent'))).toBe(true);
  });
  it('стоит в широкой стойке — ничего', () => {
    const res = runSession(
      track(0, 1000, () => ({}), { rest: { stance: 2.2 } }),
      def('side_leg_raise'),
    );
    expect(res.reps).toHaveLength(0);
    expect(res.shown).toEqual([]);
  });
});

describe('боковые выпады', () => {
  it('6 выпадов до параллели — 6, без ошибок; на 15 FPS тоже', () => {
    clean(lungeTrack(6, {}), 'side_lunge', 6);
    clean(lungeTrack(6, {}, 15), 'side_lunge', 6);
  });
  it('стороны чередуются: левая, правая', () => {
    const res = runSession(lungeTrack(4, {}), def('side_lunge'));
    expect(res.reps.map((r) => (r.ctx.atBottom as unknown as { side: string }).side)).toEqual([
      'left',
      'right',
      'left',
      'right',
    ]);
  });
  it('неглубоко — «опустись ниже»', () => {
    const res = runSession(lungeTrack(6, { depth: 0.12 }), def('side_lunge'));
    expect(res.reps.length + res.attempts.length).toBe(6);
    expect([...res.reps, ...res.attempts].every((r) => r.errors.includes('shallow_side'))).toBe(true);
  });
  it('узкая стойка — вторая нога сгибается: «выпрями вторую ногу»', () => {
    const res = runSession(lungeTrack(6, { stance: 0.2 }), def('side_lunge'));
    expect(res.reps.every((r) => r.errors.includes('straight_leg_bent'))).toBe(true);
  });
  it('колено заваливается внутрь — «колено по линии носка»', () => {
    expect(shown(runSession(lungeTrack(6, { kneeIn: 2.5 }), def('side_lunge')))).toContain('knee_in');
  });
});

describe('присед с выпрыгиванием', () => {
  const jumps = (o: { depth?: number; air?: number; fps?: number } = {}) => {
    const { depth = 100, air = 0.08 } = o;
    const noise = gaussian(0.003, 13);
    const frames: PoseFrame[] = [];
    const period = 2200;
    for (let t = 0; t <= 1500 + 6 * period + 1000; t += 1000 / (o.fps ?? 30)) {
      const u = t - 1500;
      let thigh = 0;
      let lift = 0;
      if (u >= 0 && u < 6 * period) {
        const k = (u % period) / period;
        if (k < 0.5) thigh = depth * wave(k / 0.5);
        else if (k < 0.75) lift = air * Math.sin((Math.PI * (k - 0.5)) / 0.25);
      }
      frames.push(synthFrame({ ...squatPose(thigh), footY: 0.92 - lift }, t, noise));
    }
    return frames;
  };
  it('6 прыжков из приседа — 6, без ошибок; на 15 FPS тоже', () => {
    clean(jumps(), 'jump_squat', 6);
    clean(jumps({ fps: 15 }), 'jump_squat', 6);
  });
  it('присел и встал без прыжка — повтор, но «выпрыгни вверх»', () => {
    const res = runSession(jumps({ air: 0 }), def('jump_squat'));
    expect(res.reps).toHaveLength(6);
    expect(res.reps.every((r) => r.errors.includes('no_jump'))).toBe(true);
  });
  it('неглубокий присед перед прыжком — «сядь глубже»', () => {
    const res = runSession(jumps({ depth: 50 }), def('jump_squat'));
    expect([...res.reps, ...res.attempts].every((r) => r.errors.includes('shallow_depth'))).toBe(true);
    expect(shown(res)).toContain('shallow_depth');
  });
});

describe('подъём на носки', () => {
  const raises = (h: number, periodMs = 2000, fps = 30) =>
    track(8, periodMs, (k) => ({ onToes: h * wave(k) }), { fps });

  it('8 подъёмов на носки — 8, без ошибок; на 15 FPS тоже', () => {
    clean(raises(0.035), 'calf_raise', 8);
    clean(raises(0.035, 2000, 15), 'calf_raise', 8);
  });
  it('невысоко — «поднимись выше на носки»', () => {
    const res = runSession(raises(0.022), def('calf_raise'));
    expect([...res.reps, ...res.attempts].length).toBe(8);
    expect([...res.reps, ...res.attempts].every((r) => r.errors.includes('low_raise'))).toBe(true);
  });
  it('слишком быстро — «медленнее»', () => {
    const res = runSession(raises(0.035, 1000), def('calf_raise'));
    expect(res.reps.length).toBeGreaterThanOrEqual(6);
    expect(res.reps.every((r) => r.errors.includes('too_fast'))).toBe(true);
  });
  it('шаг от камеры (человек в кадре становится меньше и выше) — не подъём на носки', () => {
    const noise = gaussian(0.003, 3);
    const frames: PoseFrame[] = [];
    for (let t = 0; t < 8000; t += 33) {
      const k = Math.min(1, Math.max(0, (t - 2000) / 1500));
      frames.push(synthFrame({ ...STAND, height: 0.75 - 0.12 * k, footY: 0.92 - 0.06 * k }, t, noise));
    }
    const res = runSession(frames, def('calf_raise'));
    expect(res.reps).toHaveLength(0);
    expect(res.attempts).toHaveLength(0);
  });
});

describe('«звёздочка» с перекрёстом', () => {
  const jacks = (o: { cross?: number; stance?: number; fps?: number; armsLow?: boolean } = {}) =>
    track(
      8,
      1100,
      (k) => ({
        armsIn: (o.cross ?? 1) * (1 - wave(k)),
        stance: -0.4 + (o.stance ?? 4) * wave(k),
        ...(o.armsLow ? { circle: { angle: Math.PI, radius: 0.12 * wave(k) } } : {}),
      }),
      { fps: o.fps, rest: { armsIn: o.cross ?? 1, stance: -0.4 } },
    );
  it('8 прыжков с перекрёстом — 8, без ошибок; на 15 FPS тоже', () => {
    clean(jacks(), 'cross_jack', 8);
    clean(jacks({ fps: 15 }), 'cross_jack', 8);
  });
  it('руки не скрещиваются — «скрести руки перед грудью»', () => {
    const res = runSession(jacks({ cross: 0.5 }), def('cross_jack'));
    expect(res.reps.length).toBeGreaterThanOrEqual(7);
    expect(res.reps.every((r) => r.errors.includes('no_cross'))).toBe(true);
  });
  it('ноги узко — «шире ноги»', () => {
    const res = runSession(jacks({ stance: 1.8 }), def('cross_jack'));
    expect(res.reps.length).toBeGreaterThanOrEqual(7);
    expect(res.reps.every((r) => r.errors.includes('feet_narrow'))).toBe(true);
  });
  it('стоит, руки вдоль тела — ничего', () => {
    const res = runSession(
      track(0, 1000, () => ({})),
      def('cross_jack'),
    );
    expect(res.reps).toHaveLength(0);
    expect(res.shown).toEqual([]);
  });
});

describe('круги руками', () => {
  const circles = (
    o: { radius?: number; periodMs?: number; fps?: number; elbow?: number; drop?: number } = {},
  ) =>
    track(10, o.periodMs ?? 1000, (k) => ({ circle: { angle: 2 * Math.PI * k, radius: o.radius ?? 0.06 } }), {
      fps: o.fps,
      rest: { circle: { angle: 0, radius: 0 } },
    });
  it('10 кругов — 10, без ошибок; на 15 FPS и медленнее тоже', () => {
    // Первый круг уходит на то, чтобы понять, где его центр: засчитываем от 9.
    for (const res of [circles(), circles({ fps: 15 }), circles({ periodMs: 1600 })].map((f) =>
      runSession(f, def('arm_circles')),
    )) {
      expect(res.reps.length).toBeGreaterThanOrEqual(9);
      expect(res.reps.length).toBeLessThanOrEqual(10);
      expect(errorsOf(res)).toEqual([]);
    }
  });
  it('маленькие круги — «круги шире»', () => {
    const res = runSession(circles({ radius: 0.022 }), def('arm_circles'));
    expect(res.reps.length).toBeGreaterThanOrEqual(8);
    expect(res.reps.every((r) => r.errors.includes('small_circles'))).toBe(true);
  });
  it('руки в стороны неподвижно — ни кругов, ни подсказок', () => {
    const res = runSession(
      track(0, 1000, () => ({}), { rest: { circle: { angle: 0, radius: 0 } } }),
      def('arm_circles'),
    );
    expect(res.reps).toHaveLength(0);
    expect(res.attempts).toHaveLength(0);
    expect(res.shown).toEqual([]);
  });
  it('руки опущены — «держи руки на уровне плеч», и кругов не считаем', () => {
    const res = runSession(
      track(6, 1000, () => ({})),
      def('arm_circles'),
    );
    expect(res.reps).toHaveLength(0);
    expect(shown(res)).toContain('arms_low');
  });
});
