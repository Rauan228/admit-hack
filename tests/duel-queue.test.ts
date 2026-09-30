// Подбор соперника: очередь по доске, ближайшие кубки, окно растёт с ожиданием, один поиск на аккаунт.

import { describe, expect, it } from 'vitest';
import { SeekQueue, seekWindow, type Seeker } from '../server/duelQueue.ts';

function s(ref: string, userId: number, cups: number, since = 0, extra: Partial<Seeker<string>> = {}) {
  return { ref, userId, cups, since, exercise: 'push_up', durationMs: 60_000, ...extra };
}

describe('очередь подбора', () => {
  it('окно по кубкам: ±50, после 10 с ±150, после 20 с — любой', () => {
    expect(seekWindow(0)).toBe(50);
    expect(seekWindow(9_999)).toBe(50);
    expect(seekWindow(10_000)).toBe(150);
    expect(seekWindow(20_000)).toBe(Infinity);
  });

  it('пара — только на той же доске (упражнение и время)', () => {
    const q = new SeekQueue<string>();
    q.add(s('a', 1, 0));
    q.add(s('b', 2, 0, 0, { exercise: 'squat' }));
    q.add(s('c', 3, 0, 0, { durationMs: 30_000 }));
    expect(q.pairs(0)).toEqual([]);
    q.add(s('d', 4, 10));
    const [pair] = q.pairs(0);
    expect(pair!.map((x) => x.ref).sort()).toEqual(['a', 'd']);
    expect(q.size).toBe(2);
  });

  it('из подходящих — ближайший по кубкам', () => {
    const q = new SeekQueue<string>();
    q.add(s('a', 1, 100));
    q.add(s('far', 2, 140, 1));
    q.add(s('near', 3, 110, 2));
    const [pair] = q.pairs(3);
    expect(pair!.map((x) => x.ref)).toEqual(['a', 'near']);
    expect(q.all().map((x) => x.ref)).toEqual(['far']);
  });

  it('окно растёт с ожиданием: через 10 с — ±150, через 20 с — любой', () => {
    const q = new SeekQueue<string>();
    q.add(s('a', 1, 0, 0));
    q.add(s('b', 2, 120, 0));
    expect(q.pairs(5_000)).toEqual([]);
    expect(q.pairs(10_000)).toHaveLength(1);

    q.add(s('c', 3, 0, 0));
    q.add(s('d', 4, 900, 0));
    expect(q.pairs(19_000)).toEqual([]);
    expect(q.pairs(20_000)).toHaveLength(1);
  });

  it('долго ждущий берёт и новичка с далёкими кубками', () => {
    const q = new SeekQueue<string>();
    q.add(s('old', 1, 0, 0));
    q.add(s('new', 2, 500, 25_000));
    expect(q.pairs(25_000)).toHaveLength(1);
  });

  it('один поиск на аккаунт: новый снимает прежний (другая вкладка); себя с собой не сводим', () => {
    const q = new SeekQueue<string>();
    q.add(s('tab1', 1, 0));
    const replaced = q.add(s('tab2', 1, 0));
    expect(replaced.map((x) => x.ref)).toEqual(['tab1']);
    expect(q.size).toBe(1);
    expect(q.pairs(60_000)).toEqual([]);
  });

  it('отмена и счётчики по доскам', () => {
    const q = new SeekQueue<string>();
    q.add(s('a', 1, 0));
    q.add(s('b', 2, 0, 0, { exercise: 'squat', durationMs: 30_000 }));
    expect(q.stats()).toEqual({ 'push_up:60000': 1, 'squat:30000': 1 });
    expect(q.count('push_up', 60_000)).toBe(1);
    expect(q.remove('a')).toBe(true);
    expect(q.remove('a')).toBe(false);
    expect(q.stats()).toEqual({ 'squat:30000': 1 });
  });
});
