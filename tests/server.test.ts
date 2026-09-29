// API FORMA: регистрация и вход, сохранение результатов, лидерборды, личный прогресс; формулы рейтинга.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, periodStart } from '../server/app.ts';
import { hashPassword, verifyPassword } from '../server/auth.ts';
import { openDb } from '../server/db.ts';
import { EXERCISES } from '../src/engine/types';
import { RATED_EXERCISES, rate, validate, type ResultInput } from '../src/shared/rating.ts';

describe('рейтинг', () => {
  it('упражнения доски совпадают с движком', () => {
    expect([...RATED_EXERCISES].sort()).toEqual([...EXERCISES].sort());
  });

  it('челлендж: считаются только чистые приседания, при равенстве — оценка', () => {
    const a = rate({ board: 'challenge', reps: 30, cleanReps: 20, avgScore: 80, durationSec: 60 });
    const b = rate({ board: 'challenge', reps: 22, cleanReps: 20, avgScore: 90, durationSec: 60 });
    expect(a.rating).toBe(20);
    expect(b.rating).toBe(20);
    expect(b.tiebreak).toBeGreaterThan(a.tiebreak);
  });

  it('одно упражнение: индекс техники из 100, брошенный подход хуже полного', () => {
    const full = rate({ board: 'single:squat', reps: 10, cleanReps: 10, avgScore: 95, durationSec: 40 });
    const quit = rate({ board: 'single:squat', reps: 3, cleanReps: 3, avgScore: 95, durationSec: 12 });
    expect(full.rating).toBe(97);
    expect(quit.rating).toBeLessThan(full.rating);
  });

  it('быстрая тренировка: бонус за темп только за полный план', () => {
    const full = rate({ board: 'quick', reps: 24, cleanReps: 20, avgScore: 90, durationSec: 90 });
    const part = rate({ board: 'quick', reps: 10, cleanReps: 10, avgScore: 90, durationSec: 30 });
    expect(full.rating).toBe(180 + 40);
    expect(part.rating).toBe(90);
  });

  it('отсекает неправдоподобные результаты', () => {
    const ok: ResultInput = { board: 'challenge', reps: 30, cleanReps: 25, avgScore: 88, durationSec: 60 };
    expect(validate(ok)).toBeNull();
    expect(validate({ ...ok, reps: 200 })).not.toBeNull();
    expect(validate({ ...ok, cleanReps: 31 })).not.toBeNull();
    expect(validate({ ...ok, avgScore: 140 })).not.toBeNull();
    expect(validate({ ...ok, durationSec: 300 })).not.toBeNull();
    expect(validate({ ...ok, board: 'single:burpee' as never })).not.toBeNull();
  });

  it('«сегодня» начинается в полночь по Астане', () => {
    const t = Date.UTC(2026, 8, 29, 20, 0); // 01:00 по Астане 30 сентября
    expect(periodStart('day', t)).toBe(Date.UTC(2026, 8, 29, 19, 0));
  });
});

describe('пароли', () => {
  it('scrypt: верный пароль проходит, неверный — нет', () => {
    const h = hashPassword('secret-123');
    expect(verifyPassword('secret-123', h)).toBe(true);
    expect(verifyPassword('secret-124', h)).toBe(false);
  });
});

describe('API', () => {
  let server: Server;
  let base = '';
  let clock = Date.UTC(2026, 8, 29, 8, 0);

  beforeEach(async () => {
    const handle = createApp(openDb(':memory:'), { now: () => clock });
    server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  /** Клиент с «браузерной» cookie. */
  function client() {
    let cookie = '';
    return async (method: string, path: string, body?: unknown) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0]!;
      return { status: res.status, data: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
  }

  const squat = (cleanReps: number, avgScore = 90) => ({
    board: 'challenge',
    reps: cleanReps + 2,
    cleanReps,
    avgScore,
    durationSec: 60,
  });

  it('регистрация → я → выход', async () => {
    const api = client();
    expect((await api('GET', '/api/me')).data.user).toBeNull();
    const reg = await api('POST', '/api/register', { email: 'A@x.io', password: 'password1', nick: 'Рауан' });
    expect(reg.status).toBe(200);
    expect((await api('GET', '/api/me')).data.user).toMatchObject({ nick: 'Рауан', email: 'a@x.io' });
    await api('POST', '/api/logout');
    expect((await api('GET', '/api/me')).data.user).toBeNull();
  });

  it('проверяет поля и занятые почту и ник', async () => {
    const api = client();
    expect(
      (await api('POST', '/api/register', { email: 'bad', password: 'password1', nick: 'abc' })).status,
    ).toBe(400);
    expect(
      (await api('POST', '/api/register', { email: 'a@x.io', password: 'short', nick: 'abc' })).status,
    ).toBe(400);
    await api('POST', '/api/register', { email: 'a@x.io', password: 'password1', nick: 'abc' });
    const other = client();
    expect(
      (await other('POST', '/api/register', { email: 'a@x.io', password: 'password1', nick: 'xyz' })).status,
    ).toBe(409);
    expect(
      (await other('POST', '/api/register', { email: 'b@x.io', password: 'password1', nick: 'ABC' })).status,
    ).toBe(409);
    expect((await other('POST', '/api/login', { email: 'a@x.io', password: 'wrong-pass' })).status).toBe(401);
    expect((await other('POST', '/api/login', { email: 'A@X.IO', password: 'password1' })).status).toBe(200);
  });

  it('сохранять можно только после входа', async () => {
    const api = client();
    expect((await api('POST', '/api/results', squat(10))).status).toBe(401);
  });

  it('личный рекорд, прирост к прошлому разу и место в рейтинге', async () => {
    const a = client();
    const b = client();
    await a('POST', '/api/register', { email: 'a@x.io', password: 'password1', nick: 'alpha' });
    await b('POST', '/api/register', { email: 'b@x.io', password: 'password1', nick: 'bravo' });

    const first = await a('POST', '/api/results', squat(10));
    expect(first.data).toMatchObject({ personalBest: true, prevBest: null, rank: 1, players: 1 });
    await b('POST', '/api/results', squat(15));
    clock += 86_400_000; // на следующий день
    const second = await a('POST', '/api/results', squat(12));
    expect(second.data).toMatchObject({
      personalBest: true,
      prevBest: 10,
      prevLast: 10,
      rank: 2,
      players: 2,
    });
    const worse = await a('POST', '/api/results', squat(8));
    expect(worse.data).toMatchObject({ personalBest: false, prevBest: 12, prevLast: 12 });

    const all = await a('GET', '/api/leaderboard?board=challenge&period=all');
    expect(all.data.rows.map((r: { nick: string; rating: number }) => [r.nick, r.rating])).toEqual([
      ['bravo', 15],
      ['alpha', 12],
    ]);
    expect(all.data.me).toMatchObject({ rank: 2, rating: 12, me: true });

    const today = await a('GET', '/api/leaderboard?board=challenge&period=day');
    expect(today.data.rows.map((r: { nick: string }) => r.nick)).toEqual(['alpha']); // bravo был вчера

    const progress = await a('GET', '/api/me/progress');
    const ch = progress.data.boards.challenge;
    expect(ch.count).toBe(3);
    expect(ch.best.rating).toBe(12);
    expect(ch.history.map((h: { rating: number }) => h.rating)).toEqual([10, 12, 8]);
  });

  it('отклоняет неправдоподобный результат и неизвестную доску', async () => {
    const api = client();
    await api('POST', '/api/register', { email: 'a@x.io', password: 'password1', nick: 'alpha' });
    expect((await api('POST', '/api/results', { ...squat(10), reps: 500 })).status).toBe(400);
    expect((await api('GET', '/api/leaderboard?board=nope')).status).toBe(400);
  });
});

describe('база', () => {
  it('переживает сборку мусора: запросы не «финализируются»', async () => {
    const handle = createApp(openDb(':memory:'));
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(await res.json()).toEqual({ ok: true });
    await new Promise<void>((r) => server.close(() => r()));
  });
});
