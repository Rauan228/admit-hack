// Дуэль (E-25): общее для сервера и страницы — проверка записи повторов вызова.
// Запись — моменты повторов в мс от начала боя; по ней соперник видит, как рос твой счёт.
// Только чистый TS без импортов: на VPS копируются лишь server/ и src/shared/.

export const DUEL_MIN_MS = 10_000;
export const DUEL_MAX_MS = 120_000;
/** Интервал по умолчанию — отжимания (у движка 0,4 с; запас — на дрожание таймера страницы). */
export const DUEL_MIN_GAP_MS = 300;

/**
 * E-29: упражнения дуэли → минимальный интервал между повторами у движка (fsm.minRepMs в engine/config.ts;
 * планка считает секунды удержания). Здесь копия, потому что сервер не видит engine/ — сверяет тест
 * tests/duel-exercises.test.ts.
 */
export const DUEL_EXERCISES = {
  squat: 250,
  jumping_jack: 250,
  lunge: 400,
  arm_raise: 300,
  high_knees: 150,
  knee_to_elbow: 300,
  squat_press: 600,
  side_bend: 400,
  side_leg_raise: 300,
  side_lunge: 400,
  jump_squat: 300,
  calf_raise: 300,
  cross_jack: 250,
  arm_circles: 250,
  boxing: 150,
  push_up: 400,
  plank: 1000,
  burpee: 800,
} as const;

export type DuelExercise = keyof typeof DUEL_EXERCISES;

export function isDuelExercise(x: unknown): x is DuelExercise {
  return typeof x === 'string' && Object.hasOwn(DUEL_EXERCISES, x);
}

/** Минимальный интервал в записи: как у движка, минус четверть на дрожание таймера страницы. */
export function minGapMs(exercise: DuelExercise): number {
  return Math.max(100, Math.round(DUEL_EXERCISES[exercise] * 0.75));
}
/** Повтор, досчитанный движком чуть позже финиша, ещё засчитываем. */
const LATE_MS = 500;

/** null — запись правдоподобна; иначе — текст ошибки. */
export function checkTimeline(
  timeline: unknown,
  durationMs: unknown,
  exercise: unknown = 'push_up',
): string | null {
  if (!isDuelExercise(exercise)) return 'Неизвестное упражнение';
  if (typeof durationMs !== 'number' || !(durationMs >= DUEL_MIN_MS && durationMs <= DUEL_MAX_MS))
    return 'Длительность боя — от 10 до 120 секунд';
  if (!Array.isArray(timeline)) return 'Нет записи повторов';
  const gap = minGapMs(exercise);
  if (timeline.length > Math.floor(durationMs / gap)) return 'Слишком много повторов';
  let prev = -Infinity;
  for (const t of timeline) {
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > durationMs + LATE_MS)
      return 'Повтор вне времени боя';
    if (t - prev < gap) return 'Повторы слишком часто — так не бывает';
    prev = t;
  }
  return null;
}
