// Все записанные позы (tests/fixtures/*.json) через полный конвейер движка: сглаживание → измеритель →
// счётчик → правила. Ожидания лежат в самой записи (meta.expected), размечены вручную по раскадровке.
// Новая запись с meta.expected подхватывается автоматически.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createExercise } from '../src/engine/exercises';
import type { ExerciseId } from '../src/engine/types';
import { loadFixture } from './helpers/replay';
import { fixtureFrames, runSession } from './helpers/session';

interface Expected {
  reps: number;
  /** Допуск по числу повторов (запись на пределе видимости). */
  repsTolerance?: number;
  /** Хорошая техника: ни одной ошибки ни в одном повторе. */
  noErrors?: boolean;
}

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('записи поз из tests/fixtures', () => {
  it('записей не меньше шести и у каждой есть разметка, источник и лицензия', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const name of files) {
      const meta = loadFixture(name).meta as Record<string, unknown>;
      expect(meta.expected, name).toBeDefined();
      expect(meta.exercise, name).toBeDefined();
      expect(meta.license, name).toBeDefined();
      expect(meta.source, name).toBeDefined();
    }
  });

  for (const name of files) {
    const file = loadFixture(name);
    const meta = file.meta as { exercise: ExerciseId; expected: Expected };
    const tol = meta.expected.repsTolerance ?? 0;

    describe(name, () => {
      it.each([
        [30, 1],
        [15, 2],
      ])('%i FPS: повторов %s', (_fps, every) => {
        const def = createExercise(meta.exercise);
        expect(def).not.toBeNull();
        const res = runSession(fixtureFrames(file, every), def!);
        expect(res.reps.length).toBeGreaterThanOrEqual(meta.expected.reps - tol);
        expect(res.reps.length).toBeLessThanOrEqual(meta.expected.reps + tol);
        if (meta.expected.noErrors) expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
      });
    });
  }
});
