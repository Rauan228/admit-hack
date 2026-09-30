// Все записанные позы (tests/fixtures/*.json) через полный конвейер движка: сглаживание → измеритель →
// счётчик → правила. Ожидания лежат в самой записи (meta.expected), размечены вручную по раскадровке.
// Новая запись с meta.expected подхватывается автоматически.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createExercise } from '../src/engine/exercises';
import { ExerciseSession } from '../src/engine/session';
import type { ExerciseId } from '../src/engine/types';
import { engineEvents } from './helpers/engineReplay';
import { loadFixture } from './helpers/replay';
import { fixtureFrames, runSession } from './helpers/session';

interface Expected {
  reps: number;
  /** Допуск по числу повторов (запись на пределе видимости). */
  repsTolerance?: number;
  /** Хорошая техника: ни одной ошибки ни в одном повторе. */
  noErrors?: boolean;
  /**
   * Запись ускорена (время кадров восстановлено по таймеру на экране): прореживание до 15 FPS оставило бы
   * ~3 кадра на повтор — такой частоты у камеры не бывает, этот прогон не проверяем.
   */
  sped?: boolean;
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
        if (every > 1 && meta.expected.sped) return;
        const def = createExercise(meta.exercise);
        expect(def).not.toBeNull();
        const res = runSession(fixtureFrames(file, every), def!);
        expect(res.reps.length).toBeGreaterThanOrEqual(meta.expected.reps - tol);
        expect(res.reps.length).toBeLessThanOrEqual(meta.expected.reps + tol);
        if (meta.expected.noErrors) expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
      });

      it('боевой путь (ExerciseSession с фильтром правдоподобия): тот же счёт и те же ошибки', () => {
        const def = createExercise(meta.exercise)!;
        const session = new ExerciseSession(def, 1000, 0);
        // Упражнения на две стороны (выпады) засчитывают повтор парой ног; в записях размечено каждое
        // движение, поэтому сверяем одиночные движения — события half_rep.
        const unit = def.sideOf ? 'half_rep' : 'rep';
        const reps = fixtureFrames(file)
          .flatMap((f, i) => session.update(f, f?.t ?? i * 33))
          .filter((e) => e.type === unit);
        expect(reps.length).toBeGreaterThanOrEqual(meta.expected.reps - tol);
        expect(reps.length).toBeLessThanOrEqual(meta.expected.reps + tol);
        if (meta.expected.noErrors)
          expect(reps.flatMap((e) => (e.type === 'rep' || e.type === 'half_rep' ? e.errors : []))).toEqual(
            [],
          );
      });

      it('весь движок, как в приложении (присутствие, пауза, сброс): тот же счёт', async () => {
        const unit = createExercise(meta.exercise)!.sideOf ? 'half_rep' : 'rep';
        const n = (await engineEvents(file, meta.exercise)).filter((e) => e.type === unit).length;
        expect(n).toBeGreaterThanOrEqual(meta.expected.reps - tol);
        expect(n).toBeLessThanOrEqual(meta.expected.reps + tol);
      });
    });
  }
});
