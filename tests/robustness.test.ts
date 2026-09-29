import { createExercise } from '../src/engine/exercises';
import type { PoseFrame } from '../src/engine/geometry';
import { bodyOf, PersonSelector } from '../src/engine/person';
import { ExerciseSession } from '../src/engine/session';
import type { ExerciseId, Landmark } from '../src/engine/types';
import { body, buildPose } from '../src/mocks/poses';

/** Человек размером height, стоящий в точке centerX. */
const person = (centerX: number, height: number): Landmark[] =>
  buildPose(body({ centerX, height, groundY: 0.5 + height / 2 }));

describe('кого тренировать, если в кадре несколько людей', () => {
  it('берём ближайшего к камере (самого крупного)', () => {
    const s = new PersonSelector();
    expect(s.pick([person(0.8, 0.3), person(0.4, 0.7)])).toBe(1);
  });

  it('держим фокус: прохожий чуть крупнее — фокус не прыгает', () => {
    const s = new PersonSelector();
    expect(s.pick([person(0.5, 0.6), person(0.85, 0.3)])).toBe(0);
    // Прохожий подошёл и стал чуть крупнее нашего (в 1,2 раза) — всё равно тренируем прежнего.
    expect(s.pick([person(0.5, 0.6), person(0.8, 0.72)])).toBe(0);
    // Порядок в ответе модели поменялся — фокус всё равно на том же человеке.
    expect(s.pick([person(0.8, 0.72), person(0.5, 0.6)])).toBe(1);
  });

  it('другой стал намного ближе (в 1,5 раза крупнее) — переключаемся', () => {
    const s = new PersonSelector();
    s.pick([person(0.5, 0.5), person(0.85, 0.3)]);
    expect(s.pick([person(0.5, 0.5), person(0.7, 0.8)])).toBe(1);
  });

  it('наш ушёл из кадра — тренируем оставшегося', () => {
    const s = new PersonSelector();
    s.pick([person(0.5, 0.6), person(0.85, 0.3)]);
    expect(s.pick([person(0.85, 0.3)])).toBe(0);
  });

  it('никого — -1; человек без корпуса в кадре не ломает выбор', () => {
    const s = new PersonSelector();
    expect(s.pick([])).toBe(-1);
    const broken = person(0.5, 0.6).slice(0, 5);
    expect(bodyOf(broken)).toBeNull();
    expect(s.pick([broken])).toBe(0);
  });
});

/** Детерминированный генератор мусора. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('устойчивость: мусор на входе — ни крашей, ни ложных повторов', () => {
  const kinds = ['random', 'nan', 'half', 'frozen', 'none'] as const;

  it.each(['squat', 'jumping_jack', 'lunge', 'high_knees', 'knee_to_elbow', 'squat_press'] as ExerciseId[])(
    '%s: 30 с случайных кадров',
    (id) => {
      const r = rng(42);
      const session = new ExerciseSession(createExercise(id)!, 10, 0);
      const frozen = person(0.5, 0.7);
      let reps = 0;
      for (let i = 0; i < 900; i++) {
        const t = i * 33;
        const kind = kinds[Math.floor(r() * kinds.length)]!;
        let image: Landmark[] | null;
        if (kind === 'none') image = null;
        else if (kind === 'frozen') image = frozen;
        else if (kind === 'nan') image = frozen.map((p) => ({ ...p, x: NaN, y: NaN }));
        else if (kind === 'half') image = frozen.map((p, j) => (j > 22 ? { ...p, v: 0 } : p));
        else
          image = Array.from({ length: 33 }, () => ({
            x: r() * 1.4 - 0.2,
            y: r() * 1.4 - 0.2,
            z: r() - 0.5,
            v: r(),
          }));
        const frame: PoseFrame | null = image ? { t, aspect: 4 / 3, image, world: null } : null;
        for (const e of session.update(frame, t)) if (e.type === 'rep') reps += 1;
      }
      // Мусор может изредка сложиться в «движение», но уж точно не в подход повторов.
      expect(reps).toBeLessThanOrEqual(1);
    },
  );
});
