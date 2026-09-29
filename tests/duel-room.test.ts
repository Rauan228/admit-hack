// Комната онлайн-дуэли (E-26): лобби → общий отсчёт → минута боя → итог → реванш. Время — снаружи.

import { DuelRoom } from '../src/shared/duelRoom';

const A = { key: 'ka', name: 'Arslan', userId: 1 };
const B = { key: 'kb', name: 'Rauan', userId: 2 };

function pair(now = 0) {
  const r = new DuelRoom('ROOM1', { durationMs: 60_000, countdownMs: 5000 });
  r.join(A, now);
  r.join(B, now);
  return r;
}

describe('комната онлайн-дуэли', () => {
  it('двое в лобби; третьему места нет; вернувшийся занимает своё место', () => {
    const r = pair();
    expect(r.players.map((p) => p.name)).toEqual(['Arslan', 'Rauan']);
    expect(r.join({ key: 'kc', name: 'Other', userId: 3 }, 0)).toBe('В дуэли уже двое');
    expect(r.join({ key: 'new-tab', name: 'Arslan', userId: 1 }, 0)).toBe(r.players[0]); // тот же аккаунт
    expect(r.join({ key: 'kb', name: 'Гость', userId: null }, 0)).toBe(r.players[1]); // тот же ключ
    expect(r.players).toHaveLength(2);
  });

  it('когда оба готовы — общий отсчёт, потом бой и итог по времени сервера', () => {
    const r = pair();
    r.setReady('ka', true, 1000);
    expect(r.phase).toBe('lobby');
    r.setReady('kb', true, 2000);
    expect(r.phase).toBe('countdown');
    expect(r.startsAt).toBe(7000);
    expect(r.endsAt).toBe(67_000);
    r.tick(7000);
    expect(r.phase).toBe('battle');
    r.tick(67_000);
    expect(r.phase).toBe('over');
  });

  it('повторы: только в бою, не чаще 0,3 с, чуть позже финиша ещё засчитан', () => {
    const r = pair();
    r.setReady('ka', true, 0);
    r.setReady('kb', true, 0); // бой 5000…65 000
    expect(r.rep('ka', 4000)).toBe(false); // отсчёт
    expect(r.rep('ka', 6000)).toBe(true);
    expect(r.rep('ka', 6100)).toBe(false); // 0,1 с — так не бывает
    expect(r.rep('ka', 6400)).toBe(true);
    expect(r.rep('kb', 20_000)).toBe(true);
    expect(r.view('ka', 30_000)).toMatchObject({
      phase: 'battle',
      you: 0,
      players: [{ reps: 2 }, { reps: 1 }],
    });
    expect(r.rep('ka', 65_300)).toBe(true); // досчитан движком после финиша
    expect(r.rep('ka', 66_000)).toBe(false);
    expect(r.players[0]!.reps).toEqual([1000, 1400, 60_300]);
  });

  it('итог: больше повторов — победа, поровну — ничья, сдался — поражение', () => {
    const r = pair();
    r.setReady('ka', true, 0);
    r.setReady('kb', true, 0);
    r.rep('ka', 6000);
    r.tick(65_000);
    expect(r.result()).toEqual({ winner: 'ka', reason: 'reps' });

    const d = pair();
    d.setReady('ka', true, 0);
    d.setReady('kb', true, 0);
    d.tick(65_000);
    expect(d.result()).toEqual({ winner: null, reason: 'draw' });

    const g = pair();
    g.setReady('ka', true, 0);
    g.setReady('kb', true, 0);
    g.rep('kb', 6000);
    g.rep('kb', 7000);
    g.giveUp('kb', 8000);
    expect(g.phase).toBe('over');
    expect(g.result()).toEqual({ winner: 'ka', reason: 'giveup' });
  });

  it('ушёл из лобби — место свободно; ушёл посреди боя — сдался', () => {
    const r = pair();
    r.leave('kb', 0);
    expect(r.players.map((p) => p.key)).toEqual(['ka']);

    const b = pair();
    b.setReady('ka', true, 0);
    b.setReady('kb', true, 0);
    b.leave('ka', 10_000);
    expect(b.result()).toEqual({ winner: 'kb', reason: 'giveup' });
  });

  it('реванш: после итога оба снова «Готов» — новый раунд с нуля', () => {
    const r = pair();
    r.setReady('ka', true, 0);
    r.setReady('kb', true, 0);
    r.rep('ka', 6000);
    r.tick(65_000);
    expect(r.players.every((p) => !p.ready)).toBe(true);
    r.setReady('ka', true, 70_000);
    r.setReady('kb', true, 71_000);
    expect(r.phase).toBe('countdown');
    expect(r.players[0]!.reps).toEqual([]);
    expect(r.result()).toBeNull();
    expect(r.round).toBe(2);
  });

  it('вид для игрока: без ключей и id аккаунтов, с «ты» и временем сервера', () => {
    const r = pair();
    const v = r.view('kb', 123);
    expect(v).toMatchObject({
      id: 'ROOM1',
      you: 1,
      now: 123,
      players: [{ name: 'Arslan' }, { name: 'Rauan' }],
    });
    expect(JSON.stringify(v)).not.toMatch(/ka|kb|userId/);
  });
});
