import { dayKey, trainingStreak } from '../src/ui/store/progress';

const DAY = 86_400_000;
// Четверг, 1 октября 2026, полдень.
const NOW = new Date(2026, 9, 1, 12).getTime();
const days = (...back: number[]) => new Set(back.map((k) => dayKey(NOW - k * DAY)));

describe('серия дней', () => {
  it('подряд до сегодня', () => {
    expect(trainingStreak(days(0, 1, 2), NOW).days).toBe(3);
  });

  it('сегодня ещё не тренировался — серия со вчера не сгорает', () => {
    expect(trainingStreak(days(1, 2), NOW).days).toBe(2);
  });

  it('пропуск обрывает серию', () => {
    expect(trainingStreak(days(0, 2, 3), NOW).days).toBe(1);
    expect(trainingStreak(days(2, 3), NOW).days).toBe(0);
  });

  it('неделя с понедельника: отмечены дни с тренировкой', () => {
    // 1.10.2026 — четверг: понедельник 3 дня назад.
    expect(trainingStreak(days(0, 3), NOW).week).toEqual([true, false, false, true, false, false, false]);
  });
});
