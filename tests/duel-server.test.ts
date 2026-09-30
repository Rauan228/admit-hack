// API дуэлей (E-25): вызов по ссылке и игроку из списка, ответы, входящие/исходящие, друзья.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import { openDb } from '../server/db.ts';

/** 30 отжиманий за минуту, раз в 1,9 с. */
const TIMELINE = Array.from({ length: 30 }, (_, i) => 1000 + i * 1900);
const MIN = 60_000;

describe('API дуэлей', () => {
  let server: Server;
  let base = '';
  let clock = Date.UTC(2026, 8, 30, 8, 0);

  beforeEach(async () => {
    clock = Date.UTC(2026, 8, 30, 8, 0);
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

  async function user(nick: string) {
    const c = client();
    const r = await c('POST', '/api/register', { email: `${nick}@forma.kz`, nick, password: 'secret-123' });
    expect(r.status).toBe(200);
    return c;
  }

  it('вызов по ссылке: гость видит запись и отвечает, автор видит ответ', async () => {
    const arslan = await user('Arslan');
    const made = await arslan('POST', '/api/duel/challenge', { timeline: TIMELINE, durationMs: MIN });
    expect(made.status).toBe(200);
    expect(made.data.id).toMatch(/^[A-Za-z0-9]{10}$/);

    const guest = client();
    const seen = await guest('GET', `/api/duel/challenge?id=${made.data.id}`);
    expect(seen.status).toBe(200);
    expect(seen.data.challenge).toMatchObject({ from: 'Arslan', to: null, reps: 30, durationMs: MIN });
    expect(seen.data.challenge.timeline).toEqual(TIMELINE);

    const answer = await guest('POST', '/api/duel/answer', {
      id: made.data.id,
      timeline: TIMELINE.slice(0, 31).concat([59_500]),
      name: 'Вася',
    });
    expect(answer.status).toBe(200);
    expect(answer.data).toMatchObject({ reps: 31, outcome: 'win' });

    const mine = await arslan('GET', '/api/duel/inbox');
    expect(mine.data.outgoing[0]).toMatchObject({ id: made.data.id, reps: 30, to: null });
    expect(mine.data.outgoing[0].answers).toMatchObject([{ name: 'Вася', reps: 31 }]);
  });

  it('гость без имени — «Гость»; в чужих ответах нет почты', async () => {
    const arslan = await user('Arslan');
    const { data } = await arslan('POST', '/api/duel/challenge', { timeline: TIMELINE, durationMs: MIN });
    await client()('POST', '/api/duel/answer', { id: data.id, timeline: [1000] });
    const seen = await client()('GET', `/api/duel/challenge?id=${data.id}`);
    expect(seen.data.challenge.answers).toMatchObject([{ name: 'Гость', reps: 1 }]);
    expect(JSON.stringify(seen.data)).not.toContain('@');
  });

  it('вызов игроку из списка: приходит ему во входящие, ответить может только он и один раз', async () => {
    const arslan = await user('Arslan');
    const rauan = await user('Rauan');
    const other = await user('Other');

    const list = await arslan('GET', '/api/duel/players');
    const nicks = list.data.players.map((p: { nick: string }) => p.nick);
    expect(nicks).toEqual(expect.arrayContaining(['Rauan', 'Other']));
    expect(nicks).not.toContain('Arslan');
    expect(JSON.stringify(list.data)).not.toContain('@');

    const made = await arslan('POST', '/api/duel/challenge', {
      timeline: TIMELINE,
      durationMs: MIN,
      to: 'rauan',
    });
    expect(made.status).toBe(200);

    const inbox = await rauan('GET', '/api/duel/inbox');
    expect(inbox.data.incoming).toMatchObject([
      { id: made.data.id, from: 'Arslan', reps: 30, answered: null },
    ]);
    expect((await other('GET', '/api/duel/inbox')).data.incoming).toEqual([]);

    expect((await other('POST', '/api/duel/answer', { id: made.data.id, timeline: [1000] })).status).toBe(
      403,
    );
    expect((await client()('POST', '/api/duel/answer', { id: made.data.id, timeline: [1000] })).status).toBe(
      401,
    );

    const ok = await rauan('POST', '/api/duel/answer', { id: made.data.id, timeline: TIMELINE.slice(0, 12) });
    expect(ok.data).toMatchObject({ reps: 12, outcome: 'lose' });
    expect((await rauan('POST', '/api/duel/answer', { id: made.data.id, timeline: [1000] })).status).toBe(
      409,
    );
    expect((await rauan('GET', '/api/duel/inbox')).data.incoming[0].answered).toMatchObject({ reps: 12 });
  });

  it('друзья: добавить по нику, отметка в общем списке, убрать', async () => {
    const arslan = await user('Arslan');
    await user('Rauan');
    await user('Other');

    expect((await arslan('POST', '/api/duel/friends', { nick: 'rauan', add: true })).status).toBe(200);
    expect((await arslan('GET', '/api/duel/friends')).data.friends).toEqual([{ nick: 'Rauan' }]);
    const players = (await arslan('GET', '/api/duel/players')).data.players as {
      nick: string;
      friend: boolean;
    }[];
    expect(players.find((p) => p.nick === 'Rauan')?.friend).toBe(true);
    expect(players.find((p) => p.nick === 'Other')?.friend).toBe(false);

    expect((await arslan('POST', '/api/duel/friends', { nick: 'Arslan', add: true })).status).toBe(400);
    expect((await arslan('POST', '/api/duel/friends', { nick: 'nobody', add: true })).status).toBe(404);
    await arslan('POST', '/api/duel/friends', { nick: 'Rauan', add: false });
    expect((await arslan('GET', '/api/duel/friends')).data.friends).toEqual([]);
  });

  it('поиск игроков по началу ника; список и друзья — только после входа', async () => {
    const arslan = await user('Arslan');
    await user('Rauan');
    await user('Ramil');
    await user('Other');
    const found = (await arslan('GET', '/api/duel/players?q=ra')).data.players.map(
      (p: { nick: string }) => p.nick,
    );
    expect(found.sort()).toEqual(['Ramil', 'Rauan']);
    // % и _ в поиске — обычные символы, а не шаблон LIKE.
    expect((await arslan('GET', '/api/duel/players?q=%25')).data.players).toEqual([]);
    expect((await client()('GET', '/api/duel/players')).status).toBe(401);
    expect((await client()('GET', '/api/duel/friends')).status).toBe(401);
  });

  it('проверки: вход для вызова, запись повторов, адресат, свой вызов, неизвестный id', async () => {
    const arslan = await user('Arslan');
    expect(
      (await client()('POST', '/api/duel/challenge', { timeline: TIMELINE, durationMs: MIN })).status,
    ).toBe(401);
    expect(
      (await arslan('POST', '/api/duel/challenge', { timeline: [500, 600], durationMs: MIN })).status,
    ).toBe(400);
    expect(
      (await arslan('POST', '/api/duel/challenge', { timeline: TIMELINE, durationMs: 1000 })).status,
    ).toBe(400);
    const ghost = await arslan('POST', '/api/duel/challenge', {
      timeline: TIMELINE,
      durationMs: MIN,
      to: 'nobody',
    });
    expect(ghost.status).toBe(404);
    const self = await arslan('POST', '/api/duel/challenge', {
      timeline: TIMELINE,
      durationMs: MIN,
      to: 'Arslan',
    });
    expect(self.status).toBe(400);

    const { data } = await arslan('POST', '/api/duel/challenge', { timeline: TIMELINE, durationMs: MIN });
    expect((await arslan('POST', '/api/duel/answer', { id: data.id, timeline: [1000] })).status).toBe(400);
    expect((await client()('GET', '/api/duel/challenge?id=nope')).status).toBe(404);
    expect((await client()('POST', '/api/duel/answer', { id: 'nope', timeline: [1000] })).status).toBe(404);
    expect((await client()('POST', '/api/duel/answer', { id: data.id, timeline: [1, 2] })).status).toBe(400);
  });

  it('упражнение вызова (E-29): сохраняется, видно в ссылке и входящих, ответ проверяется по нему', async () => {
    const arslan = await user('Arslan');
    const rauan = await user('Rauan');
    // 150 «звёздочек» раз в 0,3 с — для отжиманий слишком быстро, для «звёздочки» — нормально.
    const jacks = Array.from({ length: 150 }, (_, i) => 400 + i * 300);
    expect((await arslan('POST', '/api/duel/challenge', { timeline: jacks, durationMs: MIN })).status).toBe(
      400,
    );
    const made = await arslan('POST', '/api/duel/challenge', {
      timeline: jacks,
      durationMs: MIN,
      exercise: 'jumping_jack',
      to: 'Rauan',
    });
    expect(made.status).toBe(200);
    const seen = await rauan('GET', `/api/duel/challenge?id=${made.data.id}`);
    expect(seen.data.challenge).toMatchObject({ exercise: 'jumping_jack', reps: 150, forMe: true });
    const inbox = await rauan('GET', '/api/duel/inbox');
    expect(inbox.data.incoming[0]).toMatchObject({ id: made.data.id, exercise: 'jumping_jack' });
    // Ответ — тоже «звёздочки»: темп, недопустимый для отжиманий, принимается.
    const answer = await rauan('POST', '/api/duel/answer', {
      id: made.data.id,
      timeline: jacks.slice(0, 140),
    });
    expect(answer.data).toMatchObject({ reps: 140, outcome: 'lose' });
    const out = await arslan('GET', '/api/duel/inbox');
    expect(out.data.outgoing[0]).toMatchObject({ exercise: 'jumping_jack', answers: [{ reps: 140 }] });
  });

  it('упражнение вызова: без поля — отжимания (старый клиент), чужое — отказ', async () => {
    const arslan = await user('Arslan');
    const old = await arslan('POST', '/api/duel/challenge', { timeline: TIMELINE, durationMs: MIN });
    expect((await client()('GET', `/api/duel/challenge?id=${old.data.id}`)).data.challenge.exercise).toBe(
      'push_up',
    );
    for (const exercise of ['plank', 'moonwalk', 42]) {
      const r = await arslan('POST', '/api/duel/challenge', {
        timeline: TIMELINE,
        durationMs: MIN,
        exercise,
      });
      expect(r.status, String(exercise)).toBe(400);
      expect(r.data.error).toMatch(/упражнение/);
    }
    // Темп выше живого: 40 отжиманий за 12 с при честном интервале 0,3 с.
    const spam = Array.from({ length: 40 }, (_, i) => 500 + i * 300);
    const r = await arslan('POST', '/api/duel/challenge', { timeline: spam, durationMs: MIN });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/темп/);
  });

  it('вызов после боя на 3 минуты принимается', async () => {
    const arslan = await user('Arslan');
    const long = Array.from({ length: 60 }, (_, i) => 1000 + i * 2900);
    const r = await arslan('POST', '/api/duel/challenge', {
      timeline: long,
      durationMs: 180_000,
      exercise: 'squat',
    });
    expect(r.status).toBe(200);
  });

  it('база до E-29 (без колонки упражнения) — дополняется, старые вызовы — отжимания', async () => {
    const db = openDb(':memory:');
    db.exec(`CREATE TABLE duel_challenges (
      id TEXT PRIMARY KEY, from_user INTEGER NOT NULL, to_user INTEGER,
      duration_ms INTEGER NOT NULL, reps INTEGER NOT NULL, timeline TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    db.exec(
      `INSERT INTO users (id, email, nick, pass, created_at) VALUES (1, 'old@forma.kz', 'Old', 'x', 0)`,
    );
    db.exec(`INSERT INTO duel_challenges VALUES ('OLD0000001', 1, NULL, 60000, 1, '[1000]', 0)`);
    const handle = createApp(db, { now: () => clock });
    const old = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => old.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(old.address() as AddressInfo).port}/api/duel/challenge?id=OLD0000001`;
    const r = (await (await fetch(url)).json()) as { challenge: { exercise: string; reps: number } };
    await new Promise<void>((done) => old.close(() => done()));
    expect(r.challenge).toMatchObject({ exercise: 'push_up', reps: 1 });
  });

  it('частые вызовы упираются в лимит', async () => {
    const arslan = await user('Arslan');
    let last = 0;
    for (let i = 0; i < 21; i += 1)
      last = (await arslan('POST', '/api/duel/challenge', { timeline: TIMELINE, durationMs: MIN })).status;
    expect(last).toBe(429);
  });
});
