import { formErrorsFor } from '../src/engine/hints';
import { scoreRep, SetTracker } from '../src/engine/scoring';
import { createSquat } from '../src/engine/exercises/squat';
import { runSession } from './helpers/session';
import { gaussian, squatPose, squatTrack, synthFrame } from './helpers/synth';

const squatCatalog = formErrorsFor('squat');

describe('оценка повтора', () => {
  it('чистый повтор — 100', () => {
    expect(scoreRep([], squatCatalog)).toBe(100);
  });

  it('штрафы из каталога складываются: глубина −30, наклон −20', () => {
    expect(scoreRep(['shallow_depth'], squatCatalog)).toBe(70);
    expect(scoreRep(['shallow_depth', 'torso_lean'], squatCatalog)).toBe(50);
  });

  it('одна и та же ошибка дважды штрафуется один раз', () => {
    expect(scoreRep(['knees_in', 'knees_in'], squatCatalog)).toBe(75);
  });

  it('оценка не ниже 10: повтор всё-таки сделан', () => {
    expect(scoreRep(['shallow_depth', 'knees_in', 'torso_lean', 'asymmetry', 'too_fast'], squatCatalog)).toBe(
      10,
    );
  });

  it('неизвестный код не штрафует (и не ломает оценку)', () => {
    expect(scoreRep(['nope'], squatCatalog)).toBe(100);
  });

  it('у каждой ошибки каждого упражнения штраф 5…40', () => {
    for (const ex of ['squat', 'jumping_jack', 'lunge', 'arm_raise'] as const) {
      for (const e of formErrorsFor(ex)) {
        expect(e.penalty).toBeGreaterThanOrEqual(5);
        expect(e.penalty).toBeLessThanOrEqual(40);
      }
    }
  });
});

describe('итоги подхода (SetStats)', () => {
  it('считаются из повторов: чистые, средняя, счётчики ошибок, оценки по порядку, длительность', () => {
    const set = new SetTracker('squat', squatCatalog);
    set.markMovement(1000);
    expect(set.addRep([], 1000, 3000)).toBe(100);
    expect(set.addRep(['shallow_depth'], 3500, 5500)).toBe(70);
    expect(set.addRep(['shallow_depth', 'knees_in'], 6000, 8250)).toBe(45);
    expect(set.stats()).toEqual({
      reps: 3,
      cleanReps: 1,
      avgScore: 72,
      durationSec: 7.3,
      errorCounts: { shallow_depth: 2, knees_in: 1 },
      perRep: [100, 70, 45],
    });
  });

  it('пустой подход — нули, а не NaN', () => {
    expect(new SetTracker('lunge', formErrorsFor('lunge')).stats()).toEqual({
      reps: 0,
      cleanReps: 0,
      avgScore: 0,
      durationSec: 0,
      errorCounts: {},
      perRep: [],
    });
  });

  it('итоги не меняются задним числом: stats() отдаёт копии', () => {
    const set = new SetTracker('squat', squatCatalog);
    set.addRep(['torso_lean'], 0, 1000);
    const s = set.stats();
    s.perRep.push(1);
    s.errorCounts.torso_lean = 99;
    expect(set.stats().perRep).toEqual([80]);
    expect(set.stats().errorCounts).toEqual({ torso_lean: 1 });
  });

  it('тестовый прогон: 5 приседаний, из них 2 мелких — итоги сходятся с ошибками повторов', () => {
    const noise = gaussian(0.003, 9);
    // Повторы 2 и 4 мелкие (бедро 65°), остальные до параллели.
    const depths = [100, 65, 100, 65, 100];
    const frames = depths.flatMap((depth, i) =>
      squatTrack({ reps: 1, depth, leadMs: i === 0 ? 1000 : 0 }).map(({ t, thigh }) =>
        synthFrame(squatPose(thigh), t + i * 4000, noise),
      ),
    );
    const res = runSession(frames, createSquat());
    const set = new SetTracker('squat', squatCatalog);
    for (const r of res.reps) set.addRep(r.errors, r.ctx.summary.startT, r.ctx.summary.endT);
    const stats = set.stats();
    expect(stats.reps).toBe(5);
    expect(stats.cleanReps).toBe(3);
    expect(stats.errorCounts).toEqual({ shallow_depth: 2 });
    expect(stats.perRep).toEqual([100, 70, 100, 70, 100]);
    expect(stats.avgScore).toBe(88);
    expect(stats.durationSec).toBeGreaterThan(15);
  });
});
