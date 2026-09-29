import { createExercise } from '../src/engine/exercises';
import { GHOST_DURATION_MS, GHOST_KEYFRAMES, ghostPoseAt } from '../src/engine/ghostPoses';
import { ExerciseSession } from '../src/engine/session';
import { EXERCISES, type ExerciseId } from '../src/engine/types';

describe('«призрак»: эталонные позы', () => {
  it('у каждого упражнения 12 ключевых кадров по 33 точки в кадре', () => {
    for (const ex of EXERCISES) {
      expect(GHOST_KEYFRAMES[ex]).toHaveLength(12);
      for (const pose of GHOST_KEYFRAMES[ex]) {
        expect(pose).toHaveLength(33);
        for (const p of pose) {
          expect(p.y).toBeGreaterThan(0);
          expect(p.y).toBeLessThan(1.05);
          expect(p.v).toBe(1);
        }
      }
    }
  });

  it('анимация по кругу: t и t + длительность — одна и та же поза, между кадрами — плавно', () => {
    for (const ex of EXERCISES) {
      const d = GHOST_DURATION_MS[ex];
      expect(ghostPoseAt(ex, 300)).toEqual(ghostPoseAt(ex, 300 + d));
      // Соседние моменты через 33 мс почти не отличаются (без рывков).
      const a = ghostPoseAt(ex, 1000);
      const b = ghostPoseAt(ex, 1033);
      const jump = Math.max(...a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y)));
      expect(jump).toBeLessThan(0.05);
    }
  });

  it('широкий холст: человек не сплющен — сжатие по x к центру', () => {
    const square = ghostPoseAt('jumping_jack', 550);
    const wide = ghostPoseAt('jumping_jack', 550, 16 / 9);
    const span = (pose: typeof square) =>
      Math.max(...pose.map((p) => p.x)) - Math.min(...pose.map((p) => p.x));
    expect(span(wide)).toBeCloseTo(span(square) / (16 / 9), 2);
  });

  // Главная проверка: движок засчитывает движение призрака как правильные повторы без ошибок.
  it.each([
    ['squat', 5],
    ['jumping_jack', 5],
    ['lunge', 4],
    ['high_knees', 8],
    ['knee_to_elbow', 4],
    ['squat_press', 4],
  ] as [ExerciseId, number][])('движок узнаёт в призраке «%s» правильные повторы без ошибок', (ex, reps) => {
    const session = new ExerciseSession(createExercise(ex)!, 100, 0);
    const d = GHOST_DURATION_MS[ex];
    // За цикл призрака: выпады — два выпада (правой и левой), колени и «локоть к колену» — две стороны.
    const perCycle = ex === 'lunge' || ex === 'high_knees' || ex === 'knee_to_elbow' ? 2 : 1;
    const cycles = reps / perCycle;
    const events = [];
    for (let t = 0; t < 1500 + cycles * d; t += 33) {
      // Первые 1,5 с стоим — движок запоминает эталон «стоя».
      const pose = ghostPoseAt(ex, t < 1500 ? 0 : t - 1500);
      events.push(...session.update({ t, aspect: 1, image: pose, world: null }, t));
    }
    // Выпады считаются парой ног: 4 выпада призрака (правой, левой, правой, левой) = 2 повтора.
    const got = events.filter((e) => e.type === 'rep');
    expect(got).toHaveLength(ex === 'lunge' ? reps / 2 : reps);
    if (ex === 'lunge') expect(events.filter((e) => e.type === 'half_rep')).toHaveLength(reps);
    expect(got.flatMap((e) => (e.type === 'rep' ? e.errors : []))).toEqual([]);
  });
});
