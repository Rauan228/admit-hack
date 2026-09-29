import { createLunge, type LungeMetrics } from '../src/engine/exercises/lunge';
import type { PoseFrame } from '../src/engine/geometry';
import { ExerciseSession } from '../src/engine/session';
import type { EngineEvent } from '../src/engine/types';
import { lungeSet } from './helpers/synth';

// Выпады: правая нога вперёд + левая нога вперёд = 1 повтор. Каждая сторона — событие half_rep,
// распознавание одиночного выпада не меняется (его проверяют tests/lunge.test.ts и записи людей).

function play(frames: PoseFrame[], target = 100): EngineEvent[] {
  const session = new ExerciseSession(createLunge(), target, 0);
  return frames.flatMap((f) => session.update(f, f.t));
}

/** Склейка подходов подряд: время второго сдвигается за первый. */
function concat(...sets: PoseFrame[][]): PoseFrame[] {
  const out: PoseFrame[] = [];
  let offset = 0;
  for (const set of sets) {
    for (const f of set) out.push({ ...f, t: f.t + offset });
    offset = (out.at(-1)?.t ?? 0) + 33;
  }
  return out;
}

const of = <T extends EngineEvent['type']>(events: EngineEvent[], type: T) =>
  events.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);

describe('выпады: повтор — пара ног', () => {
  it('4 выпада со сменой ног = 2 повтора и 4 половины', () => {
    const events = play(lungeSet({ reps: 4 }));
    expect(of(events, 'half_rep')).toHaveLength(4);
    expect(of(events, 'rep').map((e) => e.count)).toEqual([1, 2]);
  });

  it('стороны чередуются: левая, правая, левая, правая (по ноге впереди)', () => {
    const sides = of(play(lungeSet({ reps: 4 })), 'half_rep').map((e) => e.side);
    // В синтетике первой сзади правая нога — значит, впереди левая.
    expect(sides).toEqual(['left', 'right', 'left', 'right']);
  });

  it('та же нога дважды — подсказка сменить ногу и повтор не засчитан', () => {
    const one = lungeSet({ reps: 1 });
    const events = play(concat(one, one));
    expect(of(events, 'half_rep')).toHaveLength(2);
    expect(of(events, 'rep')).toHaveLength(0);
    const hint = of(events, 'form_error').find((e) => e.code === 'switch_side');
    expect(hint?.message).toBe('Теперь шагни правой ногой');
  });

  it('ошибки обеих половин попадают в повтор', () => {
    const events = play(lungeSet({ reps: 2, depth: 0.45 }));
    const [rep] = of(events, 'rep');
    expect(rep?.errors).toContain('back_knee_high');
    expect(of(events, 'half_rep').every((h) => h.errors.includes('back_knee_high'))).toBe(true);
  });

  it('цель — в парах: targetReps 2 закрывает подход после 4 выпадов', () => {
    const events = play(lungeSet({ reps: 6 }), 2);
    expect(of(events, 'set_complete')).toHaveLength(1);
    expect(of(events, 'half_rep')).toHaveLength(4);
    expect(of(events, 'set_complete')[0]?.stats.reps).toBe(2);
  });

  it('пауза между половинами (ушёл из кадра посреди второго выпада) пару не рвёт', () => {
    const frames = lungeSet({ reps: 2 });
    const session = new ExerciseSession(createLunge(), 100, 0);
    // Первый выпад целиком и начало второго (к 4,8 с человек уже опускается) — потом ушёл из кадра.
    const before = frames.filter((f) => f.t < 4800).flatMap((f) => session.update(f, f.t));
    const cut = session.interrupt();
    // Вернулся через 3 с: постоял и сделал второй выпад заново.
    const after = frames
      .filter((f) => f.t >= 3700)
      .map((f) => ({ ...f, t: f.t + 4000 }))
      .flatMap((f) => session.update(f, f.t));
    const events = [...before, ...cut, ...after];
    expect(of(events, 'half_rep').map((e) => e.side)).toEqual(['left', 'right']);
    expect(of(events, 'rep')).toHaveLength(1);
    expect(of(events, 'form_error').filter((e) => e.code === 'switch_side')).toHaveLength(0);
  });

  it('сторона не определилась — пара закрывается, ложной подсказки «та же нога» нет', () => {
    const lunge = createLunge();
    let calls = 0;
    const def = { ...lunge, sideOf: (m: LungeMetrics) => (calls++ === 0 ? null : lunge.sideOf!(m)) };
    const session = new ExerciseSession(def, 100, 0);
    const events = lungeSet({ reps: 2 }).flatMap((f) => session.update(f, f.t));
    // Первая половина угадана как правая, вторая на самом деле правая — всё равно это пара.
    expect(of(events, 'half_rep').map((e) => e.side)).toEqual(['right', 'right']);
    expect(of(events, 'rep')).toHaveLength(1);
    expect(of(events, 'form_error').filter((e) => e.code === 'switch_side')).toHaveLength(0);
  });

  it('та же нога и ошибка техники разом — говорим про технику, «смени ногу» не перебивает', () => {
    const events = play(concat(lungeSet({ reps: 1 }), lungeSet({ reps: 1, depth: 0.45 })));
    expect(of(events, 'half_rep')).toHaveLength(2);
    expect(of(events, 'rep')).toHaveLength(0);
    expect(of(events, 'form_error').map((e) => e.code)).toEqual(['back_knee_high']);
  });
});
