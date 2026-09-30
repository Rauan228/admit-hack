import { BOTS, botTimeline, findBot, repsAt } from '../src/duel/bot';
import { DuelMatch, formatClock, outcome, tugShare } from '../src/duel/match';
import { checkTimeline } from '../src/shared/duel';

const MIN = 60_000;

describe('дуэль: соперник-бот', () => {
  it('делает ровно total повторов, по возрастанию и внутри минуты', () => {
    const t = botTimeline(117, MIN, 7);
    expect(t).toHaveLength(117);
    for (let i = 1; i < t.length; i += 1) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
    expect(t[0]!).toBeGreaterThan(0);
    expect(t.at(-1)!).toBeLessThanOrEqual(MIN);
  });

  it('темп живой: к концу минуты устаёт, но быстрее человека не бывает (≥ 0,3 с на повтор)', () => {
    const t = botTimeline(117, MIN, 7);
    const gaps = t.map((v, i) => v - (t[i - 1] ?? 0));
    const q = Math.floor(gaps.length / 4);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(gaps.slice(-q))).toBeGreaterThan(mean(gaps.slice(0, q)) * 1.15);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(300);
  });

  it('одно зерно — один и тот же бой, другое зерно — другой', () => {
    expect(botTimeline(50, MIN, 3)).toEqual(botTimeline(50, MIN, 3));
    expect(botTimeline(50, MIN, 3)).not.toEqual(botTimeline(50, MIN, 4));
  });

  it('repsAt: повтор засчитан в момент, когда сделан', () => {
    const t = [1000, 2000, 3000];
    expect(repsAt(t, 0)).toBe(0);
    expect(repsAt(t, 999)).toBe(0);
    expect(repsAt(t, 1000)).toBe(1);
    expect(repsAt(t, 2500)).toBe(2);
    expect(repsAt(t, MIN)).toBe(3);
  });

  it('соперники от слабого к сильному; «Машина» — 117 за минуту, как в ролике', () => {
    const totals = BOTS.map((b) => b.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(findBot('machine').total).toBe(117);
    expect(findBot('нет такого').id).toBe(BOTS[1]!.id);
  });
});

describe('дуэль: проверка записи повторов (общая для сервера и страницы)', () => {
  it('правдоподобная запись проходит', () => {
    expect(checkTimeline([800, 1700, 2300], MIN)).toBeNull();
    expect(checkTimeline([], MIN)).toBeNull(); // ноль повторов — тоже результат
  });

  it('отсекает мусор и невозможное', () => {
    expect(checkTimeline('x', MIN)).not.toBeNull();
    expect(checkTimeline([800, 'a'], MIN)).not.toBeNull();
    expect(checkTimeline([1700, 800], MIN)).not.toBeNull(); // не по порядку
    expect(checkTimeline([800, 900], MIN)).not.toBeNull(); // 0,1 с между повторами — так не отжимаются
    expect(checkTimeline([-5], MIN)).not.toBeNull();
    expect(checkTimeline([MIN + 2000], MIN)).not.toBeNull(); // после конца боя
    expect(
      checkTimeline(
        Array.from({ length: 201 }, (_, i) => i * 300),
        MIN,
      ),
    ).not.toBeNull();
  });

  it('длительность боя — от 10 с до 3 минут', () => {
    expect(checkTimeline([], 5000)).not.toBeNull();
    expect(checkTimeline([], 181_000)).not.toBeNull();
    expect(checkTimeline([], 180_000)).toBeNull();
    expect(checkTimeline([], 10_000)).toBeNull();
  });
});

describe('дуэль: счёт боя', () => {
  // Соперник: повтор каждую секунду боя.
  const everySecond = (elapsedMs: number) => Math.floor(elapsedMs / 1000);
  const make = (start = 0) =>
    new DuelMatch({ opponentReps: everySecond, countdownMs: 5000, durationMs: 60_000 }, start);

  it('во время отсчёта бой не идёт и повторы не засчитываются', () => {
    const m = make();
    expect(m.snapshot(1000)).toMatchObject({ phase: 'countdown', countdownLeftMs: 4000, me: 0, opp: 0 });
    expect(m.addRep(4999)).toBe(false);
    expect(m.snapshot(4999).me).toBe(0);
  });

  it('в бою мои повторы копятся, соперник идёт по своему темпу от начала боя', () => {
    const m = make();
    expect(m.addRep(5000 + 800)).toBe(true);
    expect(m.addRep(5000 + 1500)).toBe(true);
    expect(m.snapshot(5000 + 2500)).toMatchObject({
      phase: 'battle',
      me: 2,
      opp: 2,
      timeLeftMs: 57_500,
      outcome: null,
    });
  });

  it('через 60 с бой окончен: счёт замер, лишние повторы не идут, исход по счёту', () => {
    const m = make();
    // Повтор каждые 0,9 с, 70 штук: внутри минуты только 67 (500 + 66·900 = 59 900 мс), 3 — уже после.
    for (let i = 0; i < 70; i += 1) m.addRep(5000 + 500 + i * 900);
    const end = m.snapshot(5000 + 60_000 + 3000);
    expect(end).toMatchObject({ phase: 'over', timeLeftMs: 0, opp: 60, gaveUp: false });
    expect(end.me).toBe(67);
    expect(end.outcome).toBe('win');
    expect(m.addRep(5000 + 60_000 + 10)).toBe(false);
  });

  it('«Сдаться» — сразу поражение, счёт соперника замирает на этом моменте', () => {
    const m = make();
    m.addRep(5000 + 500);
    m.giveUp(5000 + 10_200);
    const s = m.snapshot(5000 + 30_000);
    expect(s).toMatchObject({ phase: 'over', gaveUp: true, me: 1, opp: 10, outcome: 'lose' });
    expect(m.addRep(5000 + 11_000)).toBe(false);
  });

  it('исход и полоса-перетягивание', () => {
    expect(outcome(5, 3)).toBe('win');
    expect(outcome(3, 5)).toBe('lose');
    expect(outcome(4, 4)).toBe('draw');
    expect(tugShare(0, 0)).toBe(0.5);
    expect(tugShare(1, 3)).toBe(0.25);
    expect(tugShare(3, 0)).toBe(1);
  });

  it('запоминает моменты моих повторов от начала боя — из них делается вызов другу', () => {
    const m = make();
    m.addRep(4000); // ещё отсчёт — не в счёт
    m.addRep(5000 + 800);
    m.addRep(5000 + 1700);
    expect(m.myTimeline()).toEqual([800, 1700]);
  });

  it('повтор чаще 0,3 с засчитан, но в записи сдвинут — вызов пройдёт проверку сервера', () => {
    const m = make();
    m.addRep(5000 + 1000);
    m.addRep(5000 + 1100);
    expect(m.snapshot(5000 + 1200).me).toBe(2);
    expect(m.myTimeline()).toEqual([1000, 1300]);
    expect(checkTimeline(m.myTimeline(), 60_000)).toBeNull();
  });

  it('часы: остаток округляем вверх до секунды', () => {
    expect(formatClock(60_000)).toBe('1:00');
    expect(formatClock(59_001)).toBe('1:00');
    expect(formatClock(59_000)).toBe('0:59');
    expect(formatClock(9_500)).toBe('0:10');
    expect(formatClock(0)).toBe('0:00');
  });
});
