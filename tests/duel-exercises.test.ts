// Дуэль на разных упражнениях (E-29): список с надёжным счётом, интервал и потолок темпа по упражнению.

import { ENGINE_CONFIG } from '../src/engine/config';
import { EXERCISES } from '../src/engine/types';
import { BOTS, botTimeline, botTotal } from '../src/duel/bot';
import { DuelMatch } from '../src/duel/match';
import {
  DUEL_EXERCISES,
  DUEL_EXERCISE_IDS,
  checkTimeline,
  duelExerciseOf,
  isDuelExercise,
  maxPer10s,
  minGapMs,
  paceAllows,
} from '../src/shared/duel';

const MIN = 60_000;

/** Ровный темп: повтор каждые gap мс, начиная с start. */
const even = (n: number, gap: number, start = 500) => Array.from({ length: n }, (_, i) => start + i * gap);

describe('дуэль: упражнения', () => {
  it('в дуэли — 10 упражнений с надёжным счётом, все есть в движке, отжимания первыми', () => {
    expect(DUEL_EXERCISE_IDS).toHaveLength(10);
    expect(DUEL_EXERCISE_IDS[0]).toBe('push_up');
    for (const ex of ['push_up', 'squat', 'jumping_jack', 'lunge', 'high_knees'])
      expect(isDuelExercise(ex), ex).toBe(true);
    for (const ex of DUEL_EXERCISE_IDS) expect(EXERCISES).toContain(ex);
    // Планка меряет секунды, а не повторы; у «ненадёжных» нет записей людей.
    expect(isDuelExercise('plank')).toBe(false);
    expect(isDuelExercise('calf_raise')).toBe(false);
    expect(isDuelExercise('nope')).toBe(false);
    expect(isDuelExercise(42)).toBe(false);
    expect(isDuelExercise('toString')).toBe(false);
  });

  it('старый клиент без упражнения — отжимания; чужое — отказ', () => {
    expect(duelExerciseOf(undefined)).toBe('push_up');
    expect(duelExerciseOf(null)).toBe('push_up');
    expect(duelExerciseOf('')).toBe('push_up');
    expect(duelExerciseOf('squat')).toBe('squat');
    expect(duelExerciseOf('plank')).toBeNull();
    expect(duelExerciseOf(7)).toBeNull();
  });

  it('интервал дуэли не строже движка — честный повтор не отсекается', () => {
    const cfg = ENGINE_CONFIG.exercises as unknown as Record<string, { fsm?: { minRepMs: number } }>;
    for (const ex of DUEL_EXERCISE_IDS) {
      expect(DUEL_EXERCISES[ex].minRepMs, ex).toBe(cfg[ex]!.fsm!.minRepMs);
      expect(minGapMs(ex), ex).toBeLessThanOrEqual(cfg[ex]!.fsm!.minRepMs);
    }
  });

  it('потолок темпа выше самого быстрого бота — бот и живой рекордсмен проходят проверку', () => {
    for (const ex of DUEL_EXERCISE_IDS) {
      const machine = BOTS[2]!;
      const t = botTimeline(botTotal(machine, ex, MIN), MIN, 11);
      expect(checkTimeline(t, MIN, ex), ex).toBeNull();
    }
  });

  it('проверка записи — по упражнению: бокс 5 раз в секунду можно, бёрпи — нет', () => {
    const fast = even(100, 200);
    expect(checkTimeline(fast, MIN, 'boxing')).toBeNull();
    expect(checkTimeline(fast, MIN, 'burpee')).not.toBeNull();
    expect(checkTimeline([1000], MIN, 'nope')).not.toBeNull();
    expect(checkTimeline([1000], MIN, 'plank')).not.toBeNull();
    expect(checkTimeline([1000, 1300], MIN)).toBeNull(); // по умолчанию — отжимания, как раньше
  });

  it('темп выше живого за 10 секунд — запись подделана, даже если интервал честный', () => {
    // Отжимания раз в 0,3 с — интервал проходит, но 33 за 10 с так не отжимаются.
    const spam = even(40, 300);
    expect(checkTimeline(spam, MIN, 'push_up')).toMatch(/темп/);
    // Ровно потолок за окно — можно.
    const cap = maxPer10s('push_up');
    expect(checkTimeline(even(cap, 10_000 / cap + 1), MIN, 'push_up')).toBeNull();
    expect(checkTimeline(even(cap * 3, 10_000 / cap + 1), MIN, 'push_up')).toBeNull();
  });

  it('paceAllows: окно 10 секунд, не больше maxPer10s', () => {
    const cap = maxPer10s('squat');
    const reps = even(cap, 100, 0); // cap повторов за первые cap×0,1 с
    expect(paceAllows(reps.slice(0, cap - 1), 5000, 'squat')).toBe(true);
    expect(paceAllows(reps, 5000, 'squat')).toBe(false);
    expect(paceAllows(reps, 10_000, 'squat')).toBe(true); // первый вышел из окна
  });

  it('вызов на 3 минуты проходит проверку, дольше — нет', () => {
    expect(checkTimeline(even(60, 2900), 180_000, 'squat')).toBeNull();
    expect(checkTimeline([], 181_000, 'squat')).not.toBeNull();
  });
});

describe('дуэль: бой в своём упражнении', () => {
  it('матч не засчитывает повтор выше живого темпа — запись всегда проходит сервер', () => {
    const m = new DuelMatch(
      { opponentReps: () => 0, countdownMs: 0, durationMs: MIN, exercise: 'burpee' },
      0,
    );
    let t = 100;
    for (let i = 0; i < 40; i += 1, t += 250) m.addRep(t);
    const timeline = m.myTimeline();
    expect(timeline.length).toBeLessThanOrEqual(maxPer10s('burpee'));
    expect(checkTimeline(timeline, MIN, 'burpee')).toBeNull();
  });

  it('частые события движка сдвигаются на интервал упражнения', () => {
    const m = new DuelMatch(
      { opponentReps: () => 0, countdownMs: 0, durationMs: MIN, exercise: 'boxing' },
      0,
    );
    m.addRep(1000);
    m.addRep(1010);
    expect(m.myTimeline()).toEqual([1000, 1000 + minGapMs('boxing')]);
  });

  it('темп бота — по упражнению и времени боя', () => {
    const athlete = BOTS[1]!;
    expect(botTotal(athlete, 'push_up', MIN)).toBe(athlete.total);
    expect(botTotal(athlete, 'boxing', MIN)).toBeGreaterThan(botTotal(athlete, 'burpee', MIN));
    expect(botTotal(athlete, 'squat', 30_000)).toBe(Math.round(botTotal(athlete, 'squat', MIN) / 2));
    for (const ex of DUEL_EXERCISE_IDS) {
      const totals = BOTS.map((b) => botTotal(b, ex, MIN));
      expect(totals, ex).toEqual([...totals].sort((a, b) => a - b));
    }
  });
});
