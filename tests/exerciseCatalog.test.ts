// Каталог упражнений в UI: каждое из EXERCISES — ровно в одной категории выбора, у каждого есть описание,
// мышцы и цель рейтинга (иначе новое упражнение движка молча не появится в интерфейсе).

import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../src/engine/types';
import { SINGLE_TARGET } from '../src/shared/rating';
import { MUSCLE_NAMES } from '../src/ui/lib/athlete';
import { CATEGORIES, EXERCISE_META } from '../src/ui/lib/exercises';

describe('каталог упражнений', () => {
  it('каждое упражнение — ровно в одной категории', () => {
    const listed = CATEGORIES.flatMap((c) => c.items);
    expect([...listed].sort()).toEqual([...EXERCISES].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('в категории не больше 6 плиток — крупные цели для руки', () => {
    for (const c of CATEGORIES) expect(c.items.length).toBeLessThanOrEqual(6);
  });

  it('у каждого — название, подсказки, мышцы и цель', () => {
    for (const ex of EXERCISES) {
      expect(EXERCISE_META[ex].title.length).toBeGreaterThan(2);
      expect(EXERCISE_META[ex].cues).toHaveLength(3);
      expect(MUSCLE_NAMES[ex].length).toBeGreaterThan(0);
      expect(SINGLE_TARGET[ex]).toBeGreaterThan(0);
    }
  });
});
