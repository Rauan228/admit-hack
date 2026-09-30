// Кубки арены: разряд × упражнение, пол в ноль, титул по сумме, повторный зачёт не двигает счёт.

import { describe, expect, it } from 'vitest';
import { createArena } from '../server/arena.ts';
import { openDb } from '../server/db.ts';
import { applyCups, cupDelta, describeAward, levelProgress, titleFor, xpGain } from '../src/shared/arena.ts';

describe('формулы арены', () => {
  it('равные: победа +16, ничья 0, поражение снимает, ноль остаётся нулём', () => {
    expect(cupDelta(0, 0, 'win')).toBe(16);
    expect(cupDelta(0, 0, 'draw')).toBe(0);
    expect(cupDelta(0, 0, 'lose')).toBe(-16);
    expect(applyCups(0, -16)).toEqual({ cups: 0, applied: 0 });
    expect(applyCups(16, -17)).toEqual({ cups: 0, applied: -16 });
  });

  it('андредог за победу над сильным берёт больше, чем фаворит над слабым', () => {
    expect(cupDelta(0, 400, 'win')).toBeGreaterThan(cupDelta(400, 0, 'win'));
  });

  it('опыт только за победу и выше в рапиде, чем в пуле', () => {
    expect(xpGain('bullet', 0, 0, 'lose')).toBe(0);
    expect(xpGain('bullet', 0, 0, 'draw')).toBe(0);
    expect(xpGain('rapid', 0, 0, 'win')).toBeGreaterThan(xpGain('bullet', 0, 0, 'win'));
    expect(xpGain('blitz', 0, 200, 'win')).toBeGreaterThan(xpGain('blitz', 0, 0, 'win'));
  });

  it('титул с 15 кубков, уровень растёт только вперёд', () => {
    expect(titleFor(14)).toBeNull();
    expect(titleFor(15)?.name).toBe('Искра');
    expect(titleFor(2500)?.name).toBe('Титан');
    expect(levelProgress(0)).toMatchObject({ level: 1, into: 0 });
    expect(levelProgress(40).level).toBe(2);
    expect(levelProgress(50)).toMatchObject({ level: 2, into: 10 });
  });

  it('текст поражения с нуля не обещает минус', () => {
    expect(
      describeAward({
        outcome: 'lose',
        cupsDelta: 0,
        xpDelta: 0,
        totalCups: 0,
        title: null,
        frame: null,
        titleChanged: false,
      }),
    ).toMatch(/нуля/);
  });
});

describe('зачёт в базе', () => {
  function arena() {
    const db = openDb(':memory:');
    db.exec(`INSERT INTO users (email, nick, pass, created_at) VALUES
      ('a@forma.kz', 'Arslan', 'x', 1),
      ('b@forma.kz', 'Rauan', 'x', 1)`);
    return createArena(db);
  }

  it('пуля и блиц не делят кубки; вторая запись того же боя пустая', () => {
    const store = arena();
    const first = store.settleMatch(1, {
      id: 'live:ROOM:1',
      exercise: 'push_up',
      format: 'blitz',
      a: { userId: 1, reps: 20 },
      b: { userId: 2, reps: 10 },
      winnerUserId: 1,
    });
    expect(first?.a.cupsDelta).toBe(16);
    expect(first?.a.title).toBe('Искра');
    expect(first?.a.titleChanged).toBe(true);
    expect(first?.b.cupsDelta).toBe(0);
    expect(first?.b.totalCups).toBe(0);

    expect(
      store.settleMatch(2, {
        id: 'live:ROOM:1',
        exercise: 'push_up',
        format: 'blitz',
        a: { userId: 1, reps: 20 },
        b: { userId: 2, reps: 10 },
        winnerUserId: 1,
      }),
    ).toBeNull();

    const bullet = store.ladder('bullet', 'push_up', 1);
    expect(bullet.rows).toEqual([]);
    const blitz = store.ladder('blitz', 'push_up', 1);
    expect(blitz.rows[0]).toMatchObject({ nick: 'Arslan', cups: 16, me: true });
    expect(blitz.rows[1]).toMatchObject({ nick: 'Rauan', cups: 0 });

    const all = store.ladder(null, null, null);
    expect(all.rows.map((r) => r.nick)).toEqual(['Arslan', 'Rauan']);
    expect(store.ladder('blitz', 'squat', null).rows).toEqual([]);
  });

  it('после поражения сумма не отрицательная, титул снимается', () => {
    const store = arena();
    store.settleMatch(1, {
      id: 'm1',
      exercise: 'squat',
      format: 'bullet',
      a: { userId: 1, reps: 8 },
      b: { userId: 2, reps: 3 },
      winnerUserId: 1,
    });
    const back = store.settleMatch(2, {
      id: 'm2',
      exercise: 'squat',
      format: 'bullet',
      a: { userId: 1, reps: 4 },
      b: { userId: 2, reps: 9 },
      winnerUserId: 2,
    });
    expect(back?.a.totalCups).toBe(0);
    expect(back?.a.title).toBeNull();
    expect(back?.a.titleChanged).toBe(true);
    expect(back?.b.totalCups).toBeGreaterThanOrEqual(15);
    expect(store.standing(1).cups).toBe(0);
    expect(store.standing(2).formats.find((f) => f.id === 'bullet')?.wins).toBe(1);
    expect(store.standing(2).formats.find((f) => f.id === 'blitz')?.cups).toBe(0);
  });

  it('история: последние бои глазами игрока, кривая кубков, неделя в таблице', () => {
    const store = arena();
    const day = 24 * 3600_000;
    const now = 30 * day;
    store.settleMatch(now - 10 * day, {
      id: 'live:OLD:1',
      exercise: 'push_up',
      format: 'blitz',
      a: { userId: 1, reps: 20 },
      b: { userId: 2, reps: 10 },
      winnerUserId: 1,
    });
    store.settleMatch(now - day, {
      id: 'async:C1:2',
      exercise: 'push_up',
      format: 'blitz',
      a: { userId: 1, reps: 5 },
      b: { userId: 2, reps: 9 },
      winnerUserId: 2,
    });
    const h = store.history(1);
    expect(h.total).toBe(2);
    expect(h.wins).toBe(1);
    expect(h.matches.map((m) => m.id)).toEqual(['async:C1:2', 'live:OLD:1']);
    expect(h.matches[0]).toMatchObject({
      kind: 'async',
      opponent: { nick: 'Rauan' },
      reps: 5,
      oppReps: 9,
      outcome: 'lose',
      format: 'blitz',
    });
    expect(h.matches[1]).toMatchObject({ kind: 'live', outcome: 'win', cupsDelta: 16 });
    expect(h.curve.map((p) => p.cups)).toEqual([0, 16, store.standing(1).cups]);
    expect(store.history(2).matches[0]).toMatchObject({ opponent: { nick: 'Arslan' }, outcome: 'win' });
    expect(store.boardCups(1, 'push_up', 'blitz')).toBe(store.standing(1).cups);
    expect(store.boardCups(1, 'push_up', 'bullet')).toBe(0);

    // За неделю Rauan набрал, Arslan потерял; старый бой в неделю не входит.
    const week = store.ladder(null, null, 1, 'week', now);
    expect(week.rows.map((r) => r.nick)).toEqual(['Rauan', 'Arslan']);
    expect(week.rows[0]).toMatchObject({ wins: 1, losses: 0 });
    expect(week.rows[1]!.cups).toBeLessThan(0);
    expect(store.ladder(null, null, 1, 'week', now + 30 * day).rows).toEqual([]);
  });
});
