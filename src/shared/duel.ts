// Дуэль (E-25): общее для сервера и страницы — проверка записи повторов вызова.
// Запись — моменты повторов в мс от начала боя; по ней соперник видит, как рос твой счёт.
// Только чистый TS без импортов: на VPS копируются лишь server/ и src/shared/.

export const DUEL_MIN_MS = 10_000;
export const DUEL_MAX_MS = 120_000;
export const DUEL_MAX_REPS = 200;
/** Быстрее не отжимаются (у движка минимум 0,4 с на повтор; запас — на дрожание таймера страницы). */
export const DUEL_MIN_GAP_MS = 300;
/** Повтор, досчитанный движком чуть позже финиша, ещё засчитываем. */
const LATE_MS = 500;

/** null — запись правдоподобна; иначе — текст ошибки. */
export function checkTimeline(timeline: unknown, durationMs: unknown): string | null {
  if (typeof durationMs !== 'number' || !(durationMs >= DUEL_MIN_MS && durationMs <= DUEL_MAX_MS))
    return 'Длительность боя — от 10 до 120 секунд';
  if (!Array.isArray(timeline)) return 'Нет записи повторов';
  if (timeline.length > DUEL_MAX_REPS) return 'Слишком много повторов';
  let prev = -Infinity;
  for (const t of timeline) {
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > durationMs + LATE_MS)
      return 'Повтор вне времени боя';
    if (t - prev < DUEL_MIN_GAP_MS) return 'Повторы слишком часто — так не отжимаются';
    prev = t;
  }
  return null;
}
