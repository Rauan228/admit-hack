// Онлайн-дуэль в любом из упражнений движка (E-29): лимиты повторов по упражнению.

import { ENGINE_CONFIG } from '../src/engine/config';
import { EXERCISES } from '../src/engine/types';
import { DUEL_EXERCISES, checkTimeline, isDuelExercise, minGapMs } from '../src/shared/duel';

const MIN = 60_000;

describe('дуэль: все упражнения', () => {
  it('в дуэли все 18 упражнений движка', () => {
    expect(Object.keys(DUEL_EXERCISES).sort()).toEqual([...EXERCISES].sort());
    expect(isDuelExercise('squat')).toBe(true);
    expect(isDuelExercise('nope')).toBe(false);
    expect(isDuelExercise(42)).toBe(false);
  });

  it('интервал дуэли не строже движка — честный повтор не отсекается', () => {
    const cfg = ENGINE_CONFIG.exercises as unknown as Record<string, { fsm?: { minRepMs: number } }>;
    for (const ex of EXERCISES) {
      // Планка считает секунды удержания: повтор — раз в секунду.
      const engineMin = ex === 'plank' ? 1000 : cfg[ex]!.fsm!.minRepMs;
      expect(minGapMs(ex), ex).toBeLessThanOrEqual(engineMin);
    }
  });

  it('проверка записи — по упражнению: бокс 5 раз в секунду можно, бёрпи — нет', () => {
    const fast = Array.from({ length: 100 }, (_, i) => 500 + i * 200);
    expect(checkTimeline(fast, MIN, 'boxing')).toBeNull();
    expect(checkTimeline(fast, MIN, 'burpee')).not.toBeNull();
    expect(checkTimeline([1000], MIN, 'nope')).not.toBeNull();
    expect(checkTimeline([1000, 1300], MIN)).toBeNull(); // по умолчанию — отжимания, как раньше
  });
});
