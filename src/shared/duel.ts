// Дуэль (E-25): общее для сервера и страницы — упражнения дуэли и проверка записи повторов.
// Запись — моменты повторов в мс от начала боя; по ней соперник видит, как рос твой счёт.
// Только чистый TS без импортов: на VPS копируются лишь server/ и src/shared/.

export const DUEL_MIN_MS = 10_000;
/** До 3 минут: вызов другу можно бросить после боя любой длины на выбор (15 с … 3 мин). */
export const DUEL_MAX_MS = 180_000;
/** Интервал по умолчанию — отжимания (у движка 0,4 с; запас — на дрожание таймера страницы). */
export const DUEL_MIN_GAP_MS = 300;
/** Окно проверки темпа: не больше maxPer10s повторов за любые 10 секунд. */
export const PACE_WINDOW_MS = 10_000;

export interface DuelExerciseRule {
  /** Минимальный интервал между повторами у движка (fsm.minRepMs в engine/config.ts). */
  minRepMs: number;
  /** Потолок живого темпа за 10 с — с запасом над рекордным; выше — запись подделана. */
  maxPer10s: number;
}

/**
 * Упражнения дуэли — только с надёжным счётом: у каждого свои тесты движка, у отжиманий, приседаний,
 * «звёздочки», выпадов, приседа с жимом и бёрпи — ещё и записи реальных людей (tests/fixtures).
 * Планки нет: она меряет секунды, а не повторы. Порядок — как в выборе на странице.
 * minRepMs — копия из движка (сервер не видит engine/), сверяет tests/duel-exercises.test.ts.
 */
export const DUEL_EXERCISES = {
  push_up: { minRepMs: 400, maxPer10s: 30 },
  squat: { minRepMs: 250, maxPer10s: 25 },
  jumping_jack: { minRepMs: 250, maxPer10s: 35 },
  lunge: { minRepMs: 400, maxPer10s: 15 },
  high_knees: { minRepMs: 150, maxPer10s: 70 },
  burpee: { minRepMs: 800, maxPer10s: 10 },
  squat_press: { minRepMs: 600, maxPer10s: 14 },
  knee_to_elbow: { minRepMs: 300, maxPer10s: 25 },
  arm_raise: { minRepMs: 300, maxPer10s: 25 },
  boxing: { minRepMs: 150, maxPer10s: 70 },
} as const satisfies Record<string, DuelExerciseRule>;

export type DuelExercise = keyof typeof DUEL_EXERCISES;

/** Старые клиенты не присылают упражнение — это отжимания, как было до E-29. */
export const DEFAULT_DUEL_EXERCISE: DuelExercise = 'push_up';

export const DUEL_EXERCISE_IDS = Object.keys(DUEL_EXERCISES) as DuelExercise[];

export function isDuelExercise(x: unknown): x is DuelExercise {
  return typeof x === 'string' && Object.hasOwn(DUEL_EXERCISES, x);
}

/** Упражнение из запроса: нет поля — отжимания; есть, но чужое — null (отказ). */
export function duelExerciseOf(x: unknown): DuelExercise | null {
  if (x === undefined || x === null || x === '') return DEFAULT_DUEL_EXERCISE;
  return isDuelExercise(x) ? x : null;
}

/** Минимальный интервал в записи: как у движка, минус четверть на дрожание таймера страницы. */
export function minGapMs(exercise: DuelExercise): number {
  return Math.max(100, Math.round(DUEL_EXERCISES[exercise].minRepMs * 0.75));
}

export function maxPer10s(exercise: DuelExercise): number {
  return DUEL_EXERCISES[exercise].maxPer10s;
}

/** Повтор в момент t пройдёт по темпу: за 10 с до него (включая его) — не больше maxPer10s. */
export function paceAllows(reps: readonly number[], t: number, exercise: DuelExercise): boolean {
  const cap = maxPer10s(exercise);
  const edge = reps[reps.length - cap];
  return reps.length < cap || edge === undefined || t - edge >= PACE_WINDOW_MS;
}

/** Повтор, досчитанный движком чуть позже финиша, ещё засчитываем. */
const LATE_MS = 500;

/** null — запись правдоподобна; иначе — текст ошибки. */
export function checkTimeline(
  timeline: unknown,
  durationMs: unknown,
  exercise: unknown = DEFAULT_DUEL_EXERCISE,
): string | null {
  if (!isDuelExercise(exercise)) return 'Неизвестное упражнение';
  if (typeof durationMs !== 'number' || !(durationMs >= DUEL_MIN_MS && durationMs <= DUEL_MAX_MS))
    return 'Длительность боя — от 10 секунд до 3 минут';
  if (!Array.isArray(timeline)) return 'Нет записи повторов';
  const gap = minGapMs(exercise);
  const cap = maxPer10s(exercise);
  if (timeline.length > Math.floor(durationMs / gap)) return 'Слишком много повторов';
  let prev = -Infinity;
  for (let i = 0; i < timeline.length; i += 1) {
    const t: unknown = timeline[i];
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > durationMs + LATE_MS)
      return 'Повтор вне времени боя';
    if (t - prev < gap) return 'Повторы слишком часто — так не бывает';
    // Числа до i уже проверены: по возрастанию, значит окно — просто повтор на cap раньше.
    if (i >= cap && t - (timeline[i - cap] as number) < PACE_WINDOW_MS)
      return 'Слишком быстрый темп — так не бывает';
    prev = t;
  }
  return null;
}
