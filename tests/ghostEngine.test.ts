// Эталонная анимация атлета (athleteMotion.json) → точки MediaPipe анфас и вполоборота → движок.
// Атлет показывает правильную технику, значит движок обязан засчитать каждый повтор и не придираться.
// Нашло два расхождения: «локоть к колену» скручивал корпус не в ту сторону (локоть уходил от колена),
// наклоны были мельче порога «глубже» (19,6° при 22°).

import motion from '../src/ui/lib/athleteMotion.json';
import { createExercise } from '../src/engine/exercises';
import type { PoseFrame } from '../src/engine/geometry';
import { ExerciseSession } from '../src/engine/session';
import type { ExerciseId } from '../src/engine/types';
import { gaussian } from './helpers/synth';

type Motion = { durationMs: number; keep: number[]; frames: number[][] };
const CYCLES = 5;

/** Кадры камеры: 1,5 с стоя, CYCLES циклов движения, 1,5 с стоя. amp — доля амплитуды, yaw — поворот, рад. */
function frames(ex: ExerciseId, o: { amp?: number; fps?: number; yaw?: number } = {}): PoseFrame[] {
  const m = (motion as unknown as Record<string, Motion>)[ex]!;
  const aspect = 4 / 3;
  const sy = 0.45;
  const sx = sy / aspect;
  const noise = gaussian(0.004, 7);
  const amp = o.amp ?? 1;
  const yaw = o.yaw ?? 0;
  const end = 1500 + CYCLES * m.durationMs;
  const out: PoseFrame[] = [];
  for (let t = 0; t <= end + 1500; t += 1000 / (o.fps ?? 30)) {
    const u = t < 1500 || t > end ? 0 : ((t - 1500) % m.durationMs) / m.durationMs;
    const k = u * (m.frames.length - 1);
    const i0 = Math.floor(k);
    const i1 = Math.min(m.frames.length - 1, i0 + 1);
    const a = k - i0;
    const P: { x: number; y: number; z: number }[] = [];
    m.keep.forEach((id, j) => {
      const c = (n: number) => {
        const rest = m.frames[0]![j * 3 + n]!;
        const now = m.frames[i0]![j * 3 + n]! * (1 - a) + m.frames[i1]![j * 3 + n]! * a;
        return rest + (now - rest) * amp;
      };
      const [x, y, z] = [c(0), c(1), c(2)];
      P[id] = { x: x * Math.cos(yaw) + z * Math.sin(yaw), y, z: -x * Math.sin(yaw) + z * Math.cos(yaw) };
    });
    const hipY = (P[23]!.y + P[24]!.y) / 2;
    const at = (id: number) => P[id] ?? P[0]!;
    out.push({
      t,
      aspect,
      image: Array.from({ length: 33 }, (_, id) => ({
        x: 0.5 + at(id).x * sx + noise(),
        y: 0.95 + at(id).y * sy + noise(),
        z: -at(id).z * sx,
        v: P[id] ? 0.98 : 0.3,
      })),
      world: Array.from({ length: 33 }, (_, id) => ({ x: at(id).x, y: at(id).y - hipY, z: -at(id).z })),
    });
  }
  return out;
}

function run(ex: ExerciseId, fr: PoseFrame[]) {
  const def = createExercise(ex)!;
  const session = new ExerciseSession(def, 1000, 0);
  const unit = def.sideOf ? 'half_rep' : 'rep';
  const reps: string[][] = [];
  const hints: string[] = [];
  for (const f of fr)
    for (const e of session.update(f, f.t)) {
      if (e.type === unit) reps.push((e as { errors: string[] }).errors);
      if (e.type === 'form_error') hints.push((e as { code: string }).code);
    }
  return { reps: reps.length, errors: reps.flat(), hints };
}

/** Повторов на цикл анимации (упражнения на две стороны — по движению на каждую). */
const PER_CYCLE: Partial<Record<ExerciseId, number>> = {
  squat: 1,
  jumping_jack: 1,
  lunge: 2,
  arm_raise: 1,
  burpee: 1,
  jump_squat: 1,
  squat_press: 1,
  calf_raise: 1,
  side_leg_raise: 2,
  boxing: 2,
  side_bend: 2,
  knee_to_elbow: 2,
  push_up: 1,
  high_knees: 2,
  cross_jack: 2,
  // Не здесь: боковые выпады (эталон мельче порога «глубже», но глубже — движок теряет повторы, E-37),
  // круги руками (подсказка «руки ниже плеч» внизу круга), планка (секунды, а не циклы).
};

describe('эталонная анимация атлета проходит движок чисто', () => {
  for (const [ex, n] of Object.entries(PER_CYCLE) as [ExerciseId, number][]) {
    it(`${ex}: ${CYCLES * n} повторов без ошибок — анфас, 15 FPS и вполоборота`, () => {
      for (const fr of [frames(ex), frames(ex, { fps: 15 }), frames(ex, { yaw: 0.52 })]) {
        const r = run(ex, fr);
        expect(r.reps).toBe(CYCLES * n);
        expect(r.errors).toEqual([]);
        expect(r.hints).toEqual([]);
      }
    });
  }

  it('локоть не дошёл до колена (амплитуда 70%) — повтор с «тянись локтем», половина — не повтор', () => {
    const part = run('knee_to_elbow', frames('knee_to_elbow', { amp: 0.7 }));
    expect(part.reps).toBe(10);
    expect(part.errors.every((e) => e === 'elbow_far')).toBe(true);
    expect(run('knee_to_elbow', frames('knee_to_elbow', { amp: 0.5 })).reps).toBe(0);
  });

  it('неглубокий наклон (70%) — «наклоняйся глубже»', () => {
    const r = run('side_bend', frames('side_bend', { amp: 0.7 }));
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.every((e) => e === 'shallow_bend')).toBe(true);
  });

  it('бёрпи вполсилы (50%) — не повтор, подсказка «ниже»', () => {
    const r = run('burpee', frames('burpee', { amp: 0.5 }));
    expect(r.reps).toBe(0);
    expect(r.hints).toContain('not_low');
  });
});
